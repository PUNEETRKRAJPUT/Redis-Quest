import { createClient, ErrorReply, RESP_TYPES } from 'redis';
import type { Logger } from 'pino';
import type { EventBus } from './events.js';

type Client = ReturnType<typeof createClient>;

export type RedisState = 'up' | 'down';

/** Simple-string replies come back as Buffer so the CLI can tell `OK` (status) from "OK" (bulk). */
const CLI_TYPE_MAPPING = { [RESP_TYPES.SIMPLE_STRING]: Buffer } as const;
export const CLI_TIMEOUT_MS = 8000;

export class CliTimeoutError extends Error {}

/**
 * Owns the connection to the current Redis target. Two clients: `main` is the engine's own
 * (mirror, verifiers), `cli` serves the in-browser terminal, so a learner's MULTI, SELECT, MONITOR or
 * blocking command can never wedge the engine's own traffic.
 */
export class RedisManager {
  url = '';
  state: RedisState = 'down';
  private main: Client | null = null;
  private cli: Client | null = null;
  private gen = 0;
  private everUp = false;
  private lastErrorLog = 0;
  private upListeners: Array<() => void> = [];

  constructor(
    private readonly log: Logger,
    private readonly bus: EventBus,
  ) {}

  /** Called every time the main connection becomes ready (including after a reconnect). */
  onUp(fn: () => void): void {
    this.upListeners.push(fn);
  }

  private make(gen: number, isMain: boolean): Client {
    const client = createClient({
      url: this.url,
      disableOfflineQueue: true,
      socket: {
        connectTimeout: 3000,
        reconnectStrategy: (retries: number) => Math.min(250 * (retries + 1), 2000),
      },
    });
    client.on('error', (err: Error) => {
      if (gen !== this.gen) return;
      const now = Date.now();
      if (isMain && now - this.lastErrorLog > 5000) {
        this.lastErrorLog = now;
        this.log.warn({ err: err.message, url: redact(this.url) }, 'redis connection error');
      }
      if (isMain && !client.isReady) this.setState('down');
    });
    if (isMain) {
      client.on('ready', () => {
        if (gen !== this.gen) return;
        this.setState('up');
      });
      client.on('reconnecting', () => gen === this.gen && this.setState('down'));
      client.on('end', () => gen === this.gen && this.setState('down'));
    }
    client.connect().catch((err: Error) => {
      if (gen === this.gen) this.log.warn({ err: err.message }, 'redis connect failed');
    });
    return client;
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
    this.main = this.make(gen, true);
    this.cli = this.make(gen, false);
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

  private destroyClients(): void {
    for (const c of [this.main, this.cli]) {
      try {
        c?.destroy();
      } catch {
        // already closed
      }
    }
    this.main = null;
    this.cli = null;
  }

  get isUp(): boolean {
    return this.state === 'up' && !!this.main?.isReady;
  }

  /** Engine-side command (mirror, setup, verifiers). Rejects at once when Redis is down. */
  async send<T = unknown>(argv: string[]): Promise<T> {
    if (!this.main?.isReady) throw new Error('redis is down');
    return (await this.main.sendCommand(argv)) as T;
  }

  /** Runs `fn` with the engine client (for MULTI). */
  client(): Client {
    if (!this.main?.isReady) throw new Error('redis is down');
    return this.main;
  }

  /** Terminal-side command: simple strings as Buffer, 8 s ceiling, connection reset on timeout. */
  async cliSend(argv: string[]): Promise<unknown> {
    const cli = this.cli;
    if (!cli?.isReady) throw new Error('not connected');
    let timer: NodeJS.Timeout | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new CliTimeoutError(`no reply after ${CLI_TIMEOUT_MS / 1000}s`)), CLI_TIMEOUT_MS);
    });
    try {
      return await Promise.race([cli.sendCommand(argv, { typeMapping: CLI_TYPE_MAPPING }), timeout]);
    } catch (err) {
      if (err instanceof CliTimeoutError) this.resetCli();
      throw err;
    } finally {
      clearTimeout(timer);
    }
  }

  /** Drops the terminal connection and opens a fresh one (after MONITOR, SUBSCRIBE or a timeout). */
  resetCli(): void {
    try {
      this.cli?.destroy();
    } catch {
      // ignore
    }
    this.cli = this.make(this.gen, false);
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

export function hostPort(url: string): string {
  try {
    const u = new URL(url);
    return `${u.hostname}:${u.port || '6379'}`;
  } catch {
    return url;
  }
}
