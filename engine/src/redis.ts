import { EventEmitter } from 'node:events';
import { ErrorReply, RESP_TYPES } from 'redis';
import type { Logger } from 'pino';
import {
  createTargetClient,
  describeTarget,
  parseTarget,
  type ParsedTarget,
  type TargetClient,
  type TargetKind,
} from '@quest/shared';
import type { EventBus, LevelEventData } from './events.js';
import { KeyTable } from './keytable.js';

export type RedisState = 'up' | 'down';

/** Simple-string replies come back as Buffer so the CLI can tell `OK` (status) from "OK" (bulk). */
const CLI_TYPE_MAPPING = { [RESP_TYPES.SIMPLE_STRING]: Buffer } as const;
export const CLI_TIMEOUT_MS = 8000;
/** Sentinel and cluster have no `ready`/`end` events that follow a failover, so the engine pings them. */
export const PROBE_INTERVAL_MS = 500;
const PROBE_TIMEOUT_MS = 1500;

export class CliTimeoutError extends Error {}

export interface TargetInfo {
  kind: TargetKind;
  description: string;
  state: RedisState;
  /** Sentinel only: the master the client is following right now, `host:port`. */
  master?: string;
  /** Sentinel: number of sentinels; cluster: nodes the client knows (masters plus replicas). */
  nodes?: number;
}

/** What a connected subscriber (a duplicate for one node, a fresh client for sentinel and cluster) offers. */
export interface Subscriber {
  on(event: 'error', fn: (err: Error) => void): unknown;
  subscribe(channel: string, fn: (message: string) => void): Promise<unknown>;
  pSubscribe(pattern: string, fn: (message: string) => void): Promise<unknown>;
  close(): Promise<unknown>;
  destroy(): unknown;
}

interface Hooks {
  onError(err: Error): void;
  onUp(): void;
  onDown(): void;
  /** Sentinel only. */
  onMasterChange?(node: { host: string; port: number }): void;
}

interface NodeLike {
  sendCommand(argv: string[], opts?: object): Promise<unknown>;
}
interface ClusterLike {
  isOpen: boolean;
  slots: Array<{ master: unknown }>;
  nodeByAddress?: Map<string, unknown>;
  nodeClient(node: never): Promise<NodeLike>;
  sendCommand(
    firstKey: string | undefined,
    isReadonly: boolean | undefined,
    argv: string[],
    opts?: object,
  ): Promise<unknown>;
}
interface SentinelLike {
  isReady: boolean;
  sendCommand(isReadonly: boolean | undefined, argv: string[], opts?: object): Promise<unknown>;
  getMasterNode(): { host: string; port: number } | undefined;
  multi(): { addCommand(isReadonly: boolean, argv: string[]): unknown; exec(): Promise<unknown> };
}
interface SingleLike extends NodeLike {
  isReady: boolean;
  multi(): { addCommand(argv: string[]): unknown; exec(): Promise<unknown> };
}

const keepTrying = (retries: number): number => Math.min(250 * (retries + 1), 2000);

/**
 * Sentinel node clients must give up. Measured with node-redis 5.12.1: when the master dies, Sentinel rebuilds
 * its master client and waits for that client's connect() before it asks the sentinels again. With a strategy that
 * never gives up, connect() to the dead master never settles, the rebuild never ends, one command holds the only
 * lease for good and every later command hangs, even after the sentinels have promoted a new master (a fresh client
 * works at once). A strategy that returns an Error makes connect() reject; node-redis waits a second, asks the
 * sentinels again, and finds the new master. The price: it prints the ReconnectStrategyError to stdout.
 */
const giveUpAfterTwo = (retries: number): number | Error =>
  retries >= 2
    ? new Error('giving up on this node so Sentinel can look for the new master')
    : keepTrying(retries);

function withTimeout<T>(p: Promise<T>, ms: number, what: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const t = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${what}: no answer in ${ms} ms`)), ms);
  });
  return Promise.race([p, t]).finally(() => clearTimeout(timer));
}

/**
 * One connection to the target (a node-redis client of the right kind) plus how to send a raw command on it.
 * Single node: the client's own events say up and down. Sentinel and cluster: `connect()` resolving says up the
 * first time, and (main link only) a PING every PROBE_INTERVAL_MS says up or down afterwards, because node-redis
 * follows a failover silently. If `connect()` itself fails (no sentinel answers, the cluster is not formed yet)
 * the client is thrown away and a fresh one is tried a second later, so forming the cluster after the switch works.
 */
export class Link {
  client: TargetClient | null = null;
  readonly keys = new KeyTable();
  private connected = false;
  private closed = false;
  private retryTimer: NodeJS.Timeout | undefined;
  private probeTimer: NodeJS.Timeout | undefined;
  private probing = false;

  constructor(
    readonly target: ParsedTarget,
    private readonly hooks: Hooks,
    private readonly probe: boolean,
  ) {}

  start(): void {
    this.open();
  }

  private open(): void {
    if (this.closed) return;
    const client = createTargetClient(this.target, {
      disableOfflineQueue: true,
      // A Sentinel master that has just died is often an address nobody answers on; waiting 3 s per try for it
      // makes the client late to the new master (measured: ~10 s instead of ~1 s), so Sentinel gets 1 s.
      connectTimeoutMs: this.target.kind === 'sentinel' ? 1000 : 3000,
      reconnectStrategy: this.target.kind === 'sentinel' ? giveUpAfterTwo : keepTrying,
    });
    this.client = client;
    this.connected = false;
    const ee = client as unknown as EventEmitter;
    const current = () => this.client === client && !this.closed;
    ee.on('error', (err: Error) => current() && this.hooks.onError(err));
    if (this.target.kind === 'single') {
      ee.on('ready', () => current() && this.hooks.onUp());
      ee.on('reconnecting', () => current() && this.hooks.onDown());
      ee.on('end', () => current() && this.hooks.onDown());
    } else if (this.target.kind === 'sentinel') {
      ee.on('topology-change', (e: { type: string; node: { host: string; port: number } }) => {
        if (current() && e.type === 'MASTER_CHANGE') this.hooks.onMasterChange?.(e.node);
      });
    }
    void this.connectClient(client).then(
      () => {
        if (!current()) return;
        this.connected = true;
        if (this.target.kind !== 'single') {
          this.hooks.onUp();
          if (this.probe) this.startProbe();
        }
      },
      (err: Error) => {
        if (!current()) return;
        this.hooks.onError(err);
        if (this.target.kind === 'single') return; // node-redis keeps retrying a single node itself
        this.disposeClient(client);
        this.client = null;
        this.retryTimer = setTimeout(() => this.open(), 1000);
      },
    );
  }

  private async connectClient(client: TargetClient): Promise<void> {
    await (client as unknown as { connect(): Promise<unknown> }).connect();
    if (this.target.kind === 'cluster') {
      // The key table is what lets a raw command find its slot (see KeyTable).
      this.keys.load(
        await (await this.anchor(client as unknown as ClusterLike)).sendCommand(['COMMAND']),
      );
    }
  }

  private disposeClient(client: TargetClient): void {
    try {
      const r = (client as unknown as { destroy(): unknown }).destroy();
      if (r instanceof Promise) r.catch(() => undefined);
    } catch {
      // already closed
    }
  }

  private startProbe(): void {
    if (this.probeTimer) return;
    this.probeTimer = setInterval(() => {
      if (this.probing || this.closed) return;
      this.probing = true;
      withTimeout(this.sendRaw(['PING']), PROBE_TIMEOUT_MS, 'PING')
        .then(
          () => !this.closed && this.hooks.onUp(),
          () => !this.closed && this.hooks.onDown(),
        )
        .finally(() => (this.probing = false));
    }, PROBE_INTERVAL_MS);
    this.probeTimer.unref();
  }

  get isReady(): boolean {
    const c = this.client;
    if (!c || this.closed) return false;
    if (this.target.kind === 'single') return (c as unknown as SingleLike).isReady;
    return this.connected && (c as unknown as { isOpen: boolean }).isOpen;
  }

  close(): void {
    this.closed = true;
    clearTimeout(this.retryTimer);
    clearInterval(this.probeTimer);
    if (this.client) this.disposeClient(this.client);
    this.client = null;
  }

  /** The node that owns slot 0: where a command without a key goes on a cluster, so results repeat. */
  private async anchor(cluster: ClusterLike): Promise<NodeLike> {
    const shard = cluster.slots[0];
    if (!shard) throw new Error('the cluster has no slots yet (cluster_state is not ok)');
    return cluster.nodeClient(shard.master as never);
  }

  /** Sends a raw command the way the target kind needs it. Error replies reject with ErrorReply. */
  async sendRaw(argv: string[], opts?: object): Promise<unknown> {
    const client = this.client;
    if (!client) throw new Error('not connected');
    switch (this.target.kind) {
      case 'single':
        return (client as unknown as SingleLike).sendCommand(argv, opts);
      case 'sentinel':
        // isReadonly false: the command goes to the current master, wherever that is after a failover.
        return (client as unknown as SentinelLike).sendCommand(false, argv, opts);
      case 'cluster':
        return this.sendCluster(client as unknown as ClusterLike, argv, opts);
    }
  }

  private async sendCluster(cluster: ClusterLike, argv: string[], opts?: object): Promise<unknown> {
    let key = this.keys.firstKey(argv);
    if (key === 'movable') {
      try {
        const keys = await (
          await this.anchor(cluster)
        ).sendCommand(['COMMAND', 'GETKEYS', ...argv]);
        key = Array.isArray(keys) && keys.length > 0 ? String(keys[0]) : null;
      } catch (err) {
        if (!(err instanceof ErrorReply)) throw err;
        key = null; // the server says it has no keys; it will answer the command itself
      }
    }
    if (key === null) return (await this.anchor(cluster)).sendCommand(argv, opts);
    // node-redis follows MOVED and ASK itself (up to 16 redirections) and rediscovers the slots.
    return cluster.sendCommand(key, false, argv, opts);
  }

  /** MULTI/EXEC where one node holds every key; a cluster cannot, so there the commands run one after another. */
  async transaction(cmds: string[][]): Promise<void> {
    const client = this.client;
    if (!client) throw new Error('not connected');
    if (this.target.kind === 'cluster') {
      for (const c of cmds) await this.sendRaw(c);
      return;
    }
    if (this.target.kind === 'sentinel') {
      const m = (client as unknown as SentinelLike).multi();
      for (const c of cmds) m.addCommand(false, c);
      await m.exec();
      return;
    }
    const m = (client as unknown as SingleLike).multi();
    for (const c of cmds) m.addCommand(c);
    await m.exec();
  }

  masterAddress(): string | undefined {
    if (this.target.kind !== 'sentinel' || !this.client) return undefined;
    const n = (this.client as unknown as SentinelLike).getMasterNode();
    return n ? `${n.host}:${n.port}` : undefined;
  }

  nodeCount(): number | undefined {
    if (this.target.kind === 'sentinel') return this.target.nodes.length;
    if (this.target.kind === 'cluster') {
      const m = (this.client as unknown as ClusterLike | null)?.nodeByAddress;
      return m && m.size > 0 ? m.size : this.target.nodes.length;
    }
    return undefined;
  }

  /** A connected client for SUBSCRIBE and PSUBSCRIBE that does not share this link's connection. */
  async openSubscriber(): Promise<Subscriber> {
    const client = this.client;
    if (!client) throw new Error('not connected');
    const sub =
      this.target.kind === 'single'
        ? (client as unknown as { duplicate(): TargetClient }).duplicate()
        : createTargetClient(this.target, { connectTimeoutMs: 3000 });
    const s = sub as unknown as Subscriber & { connect(): Promise<unknown> };
    s.on('error', () => undefined);
    await s.connect();
    return s;
  }
}

/**
 * Owns the connection to the current Redis target. Two links: `main` is the engine's own
 * (mirror, verifiers), `cli` serves the in-browser terminal, so a learner's MULTI, SELECT, MONITOR or
 * blocking command can never wedge the engine's own traffic.
 */
export class RedisManager {
  url = '';
  state: RedisState = 'down';
  target: ParsedTarget | null = null;
  /** The last connection error of the current target, for "could not connect" messages. */
  lastError = '';
  private main: Link | null = null;
  private cli: Link | null = null;
  private gen = 0;
  private everUp = false;
  private lastErrorLog = 0;
  private upListeners: Array<() => void> = [];
  /** Sentinel: the master before a change the client noticed but has not yet answered on. */
  private lastMaster: string | null = null;
  private pendingFailover: { from: string; to: string } | null = null;

  constructor(
    private readonly log: Logger,
    private readonly bus: EventBus,
  ) {}

  /** Called every time the main connection becomes ready (including after a reconnect). */
  onUp(fn: () => void): void {
    this.upListeners.push(fn);
  }

  get kind(): TargetKind | null {
    return this.target?.kind ?? null;
  }

  private makeLink(gen: number, isMain: boolean): Link {
    const target = this.target as ParsedTarget;
    const link = new Link(
      target,
      {
        onError: (err) => {
          if (gen !== this.gen) return;
          if (isMain) this.lastError = err.message;
          const now = Date.now();
          if (isMain && now - this.lastErrorLog > 5000) {
            this.lastErrorLog = now;
            this.log.warn({ err: err.message, url: redact(this.url) }, 'redis connection error');
          }
          if (isMain && target.kind === 'single' && !link.isReady) this.setState('down');
        },
        onUp: () => {
          if (!isMain || gen !== this.gen) return;
          this.setState('up');
          // After a Sentinel failover: announce it once the engine really can talk to the new master.
          if (this.pendingFailover) {
            const { from, to } = this.pendingFailover;
            this.pendingFailover = null;
            this.bus.emit('level.event', {
              kind: 'custom',
              name: 'sentinel_failover',
              data: { masterName: target.masterName, from, to },
            } satisfies LevelEventData);
          }
        },
        onDown: () => isMain && gen === this.gen && this.setState('down'),
        ...(isMain && target.kind === 'sentinel'
          ? {
              onMasterChange: (node: { host: string; port: number }) => {
                if (gen !== this.gen) return;
                const addr = `${node.host}:${node.port}`;
                if (this.lastMaster !== null && this.lastMaster !== addr) {
                  const from = this.pendingFailover?.from ?? this.lastMaster;
                  this.pendingFailover = from === addr ? null : { from, to: addr };
                }
                this.lastMaster = addr;
              },
            }
          : {}),
      },
      isMain && target.kind !== 'single',
    );
    link.start();
    return link;
  }

  private setState(next: RedisState): void {
    if (next === this.state) return;
    this.state = next;
    this.bus.emit('redis.state', { up: next === 'up', url: redact(this.url) });
    if (next === 'up') {
      if (this.everUp) this.bus.emit('level.event', { kind: 'redis_reconnect' });
      this.everUp = true;
      for (const fn of this.upListeners) fn();
    } else if (this.everUp) {
      this.bus.emit('level.event', { kind: 'redis_disconnect' });
    }
  }

  /** Switches (or re-opens) the connection to `url`. Waits up to ~3 s for the first ready, never throws. */
  async connect(url: string): Promise<void> {
    this.gen += 1;
    const gen = this.gen;
    this.destroyClients();
    this.url = url;
    // Switching target is not a disconnect event for a level: state resets quietly.
    this.state = 'down';
    this.everUp = false;
    this.lastError = '';
    this.lastMaster = null;
    this.pendingFailover = null;
    try {
      this.target = parseTarget(url);
    } catch (err) {
      this.target = null;
      this.lastError = (err as Error).message;
      this.log.error({ err: this.lastError, url: redact(url) }, 'redis target is not usable');
      return;
    }
    this.main = this.makeLink(gen, true);
    this.cli = this.makeLink(gen, false);
    const main = this.main;
    await new Promise<void>((resolve) => {
      if (main.isReady) return resolve();
      const timer = setTimeout(done, 3200);
      const poll = setInterval(() => main.isReady && done(), 50);
      function done() {
        clearTimeout(timer);
        clearInterval(poll);
        resolve();
      }
    });
    // `ready` may have fired before `state` was reset by a late event; make it agree.
    if (gen === this.gen && main.isReady) this.setState('up');
  }

  /**
   * Like `connect`, but when the new target does not answer the manager goes back to the previous one and says
   * why. Used by PUT /api/target with `strict`: a learner who picks a target that is not running keeps working.
   */
  async switchTo(url: string): Promise<{ ok: true } | { ok: false; message: string }> {
    const previous = this.url;
    await this.connect(url);
    if (this.isUp) return { ok: true };
    const reason = this.lastError || 'no answer within 3 seconds';
    const where = this.target ? describeTarget(this.target) : url;
    if (previous) await this.connect(previous);
    return { ok: false, message: `Could not connect to ${where}: ${reason}` };
  }

  private destroyClients(): void {
    this.main?.close();
    this.cli?.close();
    this.main = null;
    this.cli = null;
  }

  get isUp(): boolean {
    return this.state === 'up' && !!this.main?.isReady;
  }

  /** What the prompt and the GET /api/target answer say about where the engine is connected. */
  targetInfo(): TargetInfo {
    const t = this.target;
    const master = this.main?.masterAddress();
    const nodes = this.main?.nodeCount();
    return {
      kind: t?.kind ?? 'single',
      description: t ? describeTarget(t) : 'no usable target',
      state: this.isUp ? 'up' : 'down',
      ...(master ? { master } : {}),
      ...(nodes !== undefined ? { nodes } : {}),
    };
  }

  /** Engine-side command (mirror, setup, verifiers). Rejects at once when Redis is down. */
  async send<T = unknown>(argv: string[]): Promise<T> {
    if (!this.main?.isReady || (this.kind !== 'single' && this.state !== 'up'))
      throw new Error('redis is down');
    return (await this.main.sendRaw(argv)) as T;
  }

  /** The commands run as MULTI/EXEC on one node, or one after another on a cluster (keys on different slots). */
  async transaction(cmds: string[][]): Promise<void> {
    if (!this.main?.isReady || (this.kind !== 'single' && this.state !== 'up'))
      throw new Error('redis is down');
    await this.main.transaction(cmds);
  }

  /** A connected, separate client for SUBSCRIBE and PSUBSCRIBE (channel and key-expired event checks). */
  async openSubscriber(): Promise<Subscriber> {
    if (!this.main?.isReady) throw new Error('redis is down');
    return this.main.openSubscriber();
  }

  /** Terminal-side command: simple strings as Buffer, 8 s ceiling, connection reset on timeout. */
  async cliSend(argv: string[]): Promise<unknown> {
    const cli = this.cli;
    if (!cli?.isReady) throw new Error('not connected');
    let timer: NodeJS.Timeout | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(
        () => reject(new CliTimeoutError(`no reply after ${CLI_TIMEOUT_MS / 1000}s`)),
        CLI_TIMEOUT_MS,
      );
    });
    try {
      return await Promise.race([cli.sendRaw(argv, { typeMapping: CLI_TYPE_MAPPING }), timeout]);
    } catch (err) {
      if (err instanceof CliTimeoutError) this.resetCli();
      throw err;
    } finally {
      clearTimeout(timer);
    }
  }

  /** Drops the terminal connection and opens a fresh one (after MONITOR, SUBSCRIBE or a timeout). */
  resetCli(): void {
    this.cli?.close();
    this.cli = this.target ? this.makeLink(this.gen, false) : null;
  }

  close(): void {
    this.gen += 1;
    this.destroyClients();
  }
}

export function isRedisErrorReply(err: unknown): err is ErrorReply {
  return err instanceof ErrorReply;
}

/** Hides a password in a URL for logs and events. */
export function redact(url: string): string {
  try {
    const u = new URL(url);
    if (u.password) u.password = '***';
    return u.toString().replace(/\/$/, '');
  } catch {
    return url;
  }
}

/** `host:port` for a single node, otherwise the target's description. For error messages. */
export function whereIs(url: string): string {
  try {
    const t = parseTarget(url);
    return t.kind === 'single' ? hostPort(url) : describeTarget(t);
  } catch {
    return url;
  }
}

export function hostPort(url: string): string {
  try {
    const u = new URL(url);
    return `${u.hostname}:${u.port || '6379'}`;
  } catch {
    return url;
  }
}
