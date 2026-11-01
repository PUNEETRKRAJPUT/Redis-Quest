import type { Logger } from 'pino';
import {
  clientIsReady,
  createCachedRedis,
  createTargetClient,
  describeTarget,
  parseTarget,
  reconnectStrategyFor,
  type CachedRedisHandle,
  type LearnerRedis,
  type ParsedTarget,
  type TargetKind,
} from '@quest/shared';

/** A target client of any kind, typed loosely: single, Sentinel and cluster clients share the command surface. */
type Client = LearnerRedis;

interface ClientEvents {
  on(event: string, listener: (...args: never[]) => void): unknown;
  connect(): Promise<unknown>;
  close(): Promise<void>;
  destroy(): unknown;
  isOpen: boolean;
}

/** What `GET /app/target` and `/app/health` report: the app's own view of where it is connected. */
export interface TargetView {
  redisUrl: string;
  kind: TargetKind;
  description: string;
  /** True when the shared client can take commands now. */
  ready: boolean;
  /** Sentinel: the master the shared client is writing to, `host:port`; absent until the client knows it. */
  master?: string;
  /** Cluster: the masters the shared client knows about, `host:port`. */
  masters?: string[];
}

function makeClient(target: ParsedTarget, log: Logger, role: string): Client {
  const client = createTargetClient(target, {
    // Fail fast while Redis is unreachable instead of queueing: a learner slot then sees an error it can
    // handle (the "Redis is down, keep serving" lessons), and nothing replays after a reconnect.
    disableOfflineQueue: true,
    connectTimeoutMs: 3000,
    // Never give up: Redis may be down for minutes in Chapter 5 and the app must come back by itself. (Sentinel
    // is the exception, see reconnectStrategyFor: a client that never gives up never follows a failover.)
    reconnectStrategy: reconnectStrategyFor(target.kind),
  }) as unknown as ClientEvents;
  let lastMsg = '';
  let lastAt = 0;
  client.on('error', (err: Error) => {
    // One line per distinct message per 10 s: a down Redis would otherwise flood app.log.
    const now = Date.now();
    if (err.message !== lastMsg || now - lastAt > 10_000) {
      log.warn({ redis: target.url, role, err: err.message }, 'redis client error');
      lastMsg = err.message;
      lastAt = now;
    }
  });
  client.on('ready', () => log.info({ redis: target.url, role }, 'redis ready'));
  return client as unknown as Client;
}

async function closeQuietly(client: Client): Promise<void> {
  const c = client as unknown as ClientEvents;
  try {
    if (!c.isOpen) return;
    await Promise.race([
      c.close(),
      new Promise<void>((resolve) => setTimeout(resolve, 2000).unref()),
    ]);
  } catch {
    /* already closed */
  }
  try {
    if (c.isOpen) await Promise.resolve(c.destroy()).catch(() => undefined);
  } catch {
    /* ignore */
  }
}

interface Sentinelish {
  getMasterNode?: () => { host: string; port: number } | undefined;
}
interface Clusterish {
  masters?: Array<{ host: string; port: number }>;
}

/**
 * The instance's current Redis target: one shared client for every slot call, one reserved client kept for later
 * subscribe/blocking needs, and the long-lived `redisCached` client (RESP 3 with client-side caching, created
 * on first use). `switchTo` replaces all three; the engine decides the URL. The URL is one of
 * `redis://`, `rediss://`, `sentinel://<master>@h:p,...` or `cluster://h:p,...` (shared `parseTarget`).
 */
export class RedisTarget {
  private client: Client;
  private reserved: Client;
  private cachedHandle: CachedRedisHandle;
  private currentUrl: string;
  private parsed: ParsedTarget;
  private masterAddr: string | undefined;
  private masterTimer?: NodeJS.Timeout;

  constructor(
    url: string,
    private readonly log: Logger,
  ) {
    this.parsed = parseTarget(url);
    this.currentUrl = url;
    this.client = makeClient(this.parsed, log, 'shared');
    this.reserved = makeClient(this.parsed, log, 'reserved');
    this.cachedHandle = this.makeCached();
    this.connect(this.client);
    this.connect(this.reserved);
    this.watchMaster();
  }

  private makeCached(): CachedRedisHandle {
    return createCachedRedis({
      redisUrl: this.currentUrl,
      log: (line) => this.log.info({ redis: this.currentUrl, role: 'cached' }, line),
    });
  }

  private connect(c: Client): void {
    // Not awaited: the app must serve baselines even when Redis is down at boot.
    (c as unknown as ClientEvents)
      .connect()
      .catch((err: Error) => this.log.warn({ err: err.message }, 'redis connect failed'));
  }

  /** Sentinel only: remember which master the shared client writes to and log every change (a failover). */
  private watchMaster(): void {
    if (this.masterTimer) clearInterval(this.masterTimer);
    this.masterTimer = undefined;
    this.masterAddr = undefined;
    if (this.parsed.kind !== 'sentinel') return;
    const client = this.client as unknown as Sentinelish;
    const poll = (): void => {
      const n = client.getMasterNode?.();
      const addr = n ? `${n.host}:${n.port}` : undefined;
      if (addr !== undefined && addr !== this.masterAddr) {
        if (this.masterAddr !== undefined)
          this.log.warn(
            { from: this.masterAddr, to: addr, master: this.parsed.masterName },
            `sentinel master changed: ${this.masterAddr} -> ${addr}; the shared client now writes to ${addr}`,
          );
        else this.log.info({ master: addr }, `sentinel master is ${addr}`);
        this.masterAddr = addr;
      }
    };
    this.masterTimer = setInterval(poll, 100);
    this.masterTimer.unref();
  }

  get url(): string {
    return this.currentUrl;
  }

  get kind(): TargetKind {
    return this.parsed.kind;
  }

  get description(): string {
    return describeTarget(this.parsed);
  }

  get ready(): boolean {
    return clientIsReady(this.client);
  }

  /** The shared client handed to learner code (wrapped by the counting proxy per request). */
  get shared(): LearnerRedis {
    return this.client;
  }

  /** Reserved for subscribe/blocking slots (not exposed to learner code yet). */
  get reservedClient(): LearnerRedis {
    return this.reserved;
  }

  /** The long-lived `deps.redisCached` client for the current target (created on first command). */
  get cached(): LearnerRedis {
    return this.cachedHandle.client;
  }

  /** The target-related options every learner context needs; spread into `RequestScope.create`. */
  get learner(): { redis: LearnerRedis; redisCached: LearnerRedis; redisUrl: string } {
    return { redis: this.client, redisCached: this.cachedHandle.client, redisUrl: this.currentUrl };
  }

  view(): TargetView {
    const v: TargetView = {
      redisUrl: this.currentUrl,
      kind: this.parsed.kind,
      description: this.description,
      ready: this.ready,
    };
    if (this.parsed.kind === 'sentinel' && this.masterAddr) v.master = this.masterAddr;
    if (this.parsed.kind === 'cluster') {
      const masters = (this.client as unknown as Clusterish).masters;
      if (Array.isArray(masters)) v.masters = masters.map((m) => `${m.host}:${m.port}`);
    }
    return v;
  }

  async switchTo(url: string): Promise<void> {
    if (url === this.currentUrl) return;
    const next = parseTarget(url); // throws TargetError on a bad string: the current target stays
    const oldClient = this.client;
    const oldReserved = this.reserved;
    const oldCached = this.cachedHandle;
    this.log.info({ from: this.currentUrl, to: url, kind: next.kind }, 'redis target switched');
    this.currentUrl = url;
    this.parsed = next;
    this.client = makeClient(next, this.log, 'shared');
    this.reserved = makeClient(next, this.log, 'reserved');
    this.cachedHandle = this.makeCached();
    this.connect(this.client);
    this.connect(this.reserved);
    this.watchMaster();
    // In-flight commands on the old client finish (close() drains); new requests already use the new one.
    await Promise.all([closeQuietly(oldClient), closeQuietly(oldReserved), oldCached.close()]);
  }

  async close(): Promise<void> {
    if (this.masterTimer) clearInterval(this.masterTimer);
    await Promise.all([
      closeQuietly(this.client),
      closeQuietly(this.reserved),
      this.cachedHandle.close(),
    ]);
  }
}
