import { format } from 'node:util';
import pg from 'pg';
import { countRedis } from './counting.js';
import { commandTimeoutFromEnv, failFast } from './failfast.js';
import { createTargetClient, describeTarget, parseTarget, type TargetKind } from './target.js';
import type { LearnerCounters, LearnerDb, LearnerDeps, LearnerRedis } from './types.js';

export interface CreateLearnerDepsOptions {
  /**
   * A target string: redis://, rediss://, sentinel://<master>@h:p,... or cluster://h:p,... (see target.ts).
   * Defaults to env REDIS_URL, then redis://localhost:6379. With `redisClient` it is only used to build what the
   * injected client cannot: `redisCached`, and `duplicate()` on a Sentinel client (which has none).
   */
  redisUrl?: string;
  /** Defaults to env DATABASE_URL, then postgres://quest:quest@localhost:5432/quest. Ignored with `dbPool`. */
  databaseUrl?: string;
  /** Receives every `log(...)` line, already formatted to one string. */
  log?: (line: string) => void;
  /** Reuse an already connected client (the app does this); `close()` will not close it. */
  redisClient?: LearnerRedis;
  /** Reuse a long-lived `redisCached` client (the app does this); `close()` will not close it. */
  redisCached?: LearnerRedis;
  /** Reuse a pg pool (the app does this); `close()` will not end it. */
  dbPool?: pg.Pool;
  /** Redis connect timeout in ms (default 3000). */
  connectTimeoutMs?: number;
  /**
   * Per-command timeout for the learner's Redis calls in ms (default env LEARNER_REDIS_COMMAND_TIMEOUT_MS,
   * then 2000; 0 = off). A command with no reply by then rejects with RedisCommandTimeoutError.
   */
  commandTimeoutMs?: number;
}

export interface LearnerContext {
  deps: LearnerDeps;
  counters: LearnerCounters;
  /** Closes what this call created (clients, pool, duplicates); never what the caller passed in. */
  close(): Promise<void>;
}

const DEFAULT_REDIS_URL = 'redis://localhost:6379';
const DEFAULT_DATABASE_URL = 'postgres://quest:quest@localhost:5432/quest';

/**
 * Build `{ redis, db, log }` for one learner run plus the counters the proxies fill in.
 * Async because the Redis client must be connected before the learner sees it.
 */
export async function createLearnerDeps(
  opts: CreateLearnerDepsOptions = {},
): Promise<LearnerContext> {
  const counters: LearnerCounters = { redisCommands: 0, dbQueries: 0 };
  const emit = opts.log ?? (() => undefined);
  const log = (...args: unknown[]): void => emit(format(...args));

  const owned: Array<() => Promise<unknown>> = [];

  const redisUrl = opts.redisUrl ?? process.env.REDIS_URL ?? DEFAULT_REDIS_URL;
  const connectTimeoutMs = opts.connectTimeoutMs ?? 3000;
  // Fail fast: an offline client rejects at once (ClientOfflineError) and never replays queued commands. Short
  // backoff, then give up so a dead Redis becomes an error the learner can read.
  const failFastClient = (): LearnerRedis =>
    createTargetClient(parseTarget(redisUrl), {
      disableOfflineQueue: true,
      connectTimeoutMs,
      reconnectStrategy: (retries: number) =>
        retries < 3 ? 100 : new Error('Redis connection lost'),
    }) as unknown as LearnerRedis;

  let rawRedis: LearnerRedis;
  if (opts.redisClient) {
    rawRedis = opts.redisClient;
  } else {
    const created = failFastClient();
    created.on('error', (err: Error) => log(`[redis] ${err.message}`));
    await created.connect();
    owned.push(() => closeRedis(created));
    rawRedis = created;
  }

  const counted = countRedis(rawRedis, counters, {
    // A Sentinel client has no duplicate(): hand out a fresh, unconnected one, as the other kinds do.
    ...(typeof (rawRedis as { duplicate?: unknown }).duplicate !== 'function' &&
    (opts.redisUrl !== undefined || !opts.redisClient)
      ? { fallbackDuplicate: failFastClient }
      : {}),
    onDuplicate: (clone) => {
      (clone as { on?: (e: string, f: (err: Error) => void) => void }).on?.('error', (err) =>
        log(`[redis] ${err.message}`),
      );
      owned.push(() => closeRedis(clone as unknown as LearnerRedis));
    },
  });

  // redisCached: injected (the app's long-lived one) or built lazily here and closed with this context.
  let redisCached: LearnerRedis;
  if (opts.redisCached) {
    redisCached = opts.redisCached;
  } else {
    const handle = createCachedRedis({
      redisUrl,
      log: (line) => log(line),
      connectTimeoutMs,
      commandTimeoutMs: opts.commandTimeoutMs,
    });
    owned.push(() => handle.close());
    redisCached = handle.client;
  }

  // Outermost layer: every command the learner issues rejects after commandTimeoutMs.
  const redis = failFast(counted, opts.commandTimeoutMs ?? commandTimeoutFromEnv());

  let pool: pg.Pool;
  if (opts.dbPool) {
    pool = opts.dbPool;
  } else {
    pool = new pg.Pool({
      connectionString: opts.databaseUrl ?? process.env.DATABASE_URL ?? DEFAULT_DATABASE_URL,
      max: 10,
      connectionTimeoutMillis: 3000,
    });
    pool.on('error', (err) => log(`[db] ${err.message}`));
    const created = pool;
    owned.push(() => created.end());
  }
  const db: LearnerDb = {
    async query(text, params) {
      counters.dbQueries += 1;
      const res = await pool.query(text, params as unknown[] | undefined);
      return { rows: res.rows as unknown[] };
    },
  };

  return {
    deps: { redis, redisCached, db, log },
    counters,
    async close() {
      await Promise.all(owned.splice(0).map((f) => f().catch(() => undefined)));
    },
  };
}

/**
 * The reconnect strategy for a long-lived client (the app's shared client, its workers, `redisCached`): back off
 * 100 ms doubling up to 2 s and never give up, EXCEPT on Sentinel. node-redis Sentinel builds its master
 * connection inside `connect()`, and during a failover it can be told the old, dead master is still valid; with a
 * never-giving-up strategy that `connect()` never settles and every command waits behind it for ever (measured on
 * 5.12.1: no command succeeded for 35 s after a failover that Sentinel finished in 7 s). Giving up after 3 tries
 * makes it re-ask Sentinel, and the client followed the new master about 0.1 s after Sentinel announced it.
 */
export function reconnectStrategyFor(kind: TargetKind): (retries: number) => number | Error {
  if (kind === 'sentinel')
    return (retries) => (retries < 3 ? 100 * 2 ** retries : new Error('Redis connection lost'));
  return (retries) => Math.min(100 * 2 ** retries, 2000);
}

/**
 * Ready to take commands now? `isReady` on a single node and on Sentinel; a cluster client has no `isReady`
 * (its node clients are created on first use), so it counts as ready when it is open and every node client
 * created so far is ready.
 */
export function clientIsReady(c: unknown): boolean {
  const x = c as {
    isReady?: unknown;
    isOpen?: unknown;
    masters?: Array<{ client?: { isReady?: boolean } }>;
  };
  if (typeof x.isReady === 'boolean') return x.isReady;
  if (x.isOpen !== true) return false;
  if (Array.isArray(x.masters))
    return x.masters.length > 0 && x.masters.every((m) => !m.client || m.client.isReady === true);
  return true;
}

export interface CreateCachedRedisOptions {
  redisUrl: string;
  /** One line per event (created, closed); never per command. */
  log?: (line: string) => void;
  connectTimeoutMs?: number;
  /** Per-command timeout, as for `deps.redis` (default env LEARNER_REDIS_COMMAND_TIMEOUT_MS, then 2000). */
  commandTimeoutMs?: number;
  /** Default: `reconnectStrategyFor(kind)` (retry forever with a 2 s cap, except on Sentinel). */
  reconnectStrategy?: (retries: number) => number | Error;
}

export interface CachedRedisHandle {
  /** What learner code sees as `deps.redisCached`. Never created or connected until a property is first read. */
  client: LearnerRedis;
  /** True once the underlying client was created with client-side caching on. */
  readonly clientSideCache: boolean;
  /** Closes the underlying client if it was ever created; later commands reject. */
  close(): Promise<void>;
}

const CSC = { ttl: 0, maxEntries: 5000, evictPolicy: 'LRU' } as const;
const CACHED_NAMESPACES = new Set(['json', 'ft', 'ts', 'bf', 'cf', 'cms', 'topK', 'tDigest']);
const CACHED_PASSTHROUGH = new Set([
  'on',
  'once',
  'off',
  'emit',
  'addListener',
  'removeListener',
  'removeAllListeners',
  'listeners',
  'rawListeners',
  'listenerCount',
  'eventNames',
  'setMaxListeners',
  'getMaxListeners',
  'ref',
  'unref',
]);
const CACHED_LIFECYCLE = new Set(['connect', 'close', 'quit', 'destroy', 'disconnect']);
const CACHED_MULTI_RUN = new Set(['exec', 'EXEC', 'execAsPipeline']);

/**
 * The long-lived client behind `deps.redisCached`: RESP 3 plus node-redis client-side caching
 * (`{ ttl: 0, maxEntries: 5000, evictPolicy: 'LRU' }`), created on first use and connected on first command.
 *
 * Measured on node-redis 5.12.1 (docs/handoffs/A-05.md): caching works on a single node, on Sentinel and on a
 * cluster (the last two use node-redis's pooled cache), and a write from another connection invalidates the
 * entry. If building the cached client ever throws for a kind, the plain client is used and one line says so.
 * Learner lifecycle calls (connect, close, ...) are swallowed: the owner closes it. Not counted by the counting
 * proxy on purpose: a hit never reaches the server.
 */
export function createCachedRedis(opts: CreateCachedRedisOptions): CachedRedisHandle {
  const emit = opts.log ?? (() => undefined);
  const connectTimeoutMs = opts.connectTimeoutMs ?? 3000;
  const timeoutMs = opts.commandTimeoutMs ?? commandTimeoutFromEnv();
  let real: LearnerRedis | undefined;
  let guarded: LearnerRedis | undefined;
  let connecting: Promise<void> | undefined;
  let csc = false;
  let closed = false;

  const ensure = (): LearnerRedis => {
    if (closed)
      throw new Error('redisCached was closed (the Redis target changed or the run ended)');
    if (guarded) return guarded;
    const target = parseTarget(opts.redisUrl);
    const common = {
      disableOfflineQueue: true,
      connectTimeoutMs,
      reconnectStrategy: opts.reconnectStrategy ?? reconnectStrategyFor(target.kind),
    };
    try {
      real = createTargetClient(target, {
        ...common,
        RESP: 3,
        clientSideCache: { ...CSC },
      }) as unknown as LearnerRedis;
      csc = true;
      emit(
        `redisCached: ${describeTarget(target)}; RESP 3, client-side cache on (LRU, max ${CSC.maxEntries} entries, no ttl)`,
      );
    } catch (err) {
      real = createTargetClient(target, common) as unknown as LearnerRedis;
      emit(
        `redisCached: ${describeTarget(target)}; client-side cache not available (${(err as Error).message}), using the ordinary client`,
      );
    }
    real.on('error', (err: Error) => emit(`[redisCached] ${err.message}`));
    guarded = failFast(real, timeoutMs);
    return guarded;
  };

  // Start connecting on the first command; wait for it only up to the connect timeout, then let the command
  // itself fail fast (ClientOfflineError) like the plain client does while Redis is down.
  const ready = async (): Promise<void> => {
    ensure();
    connecting ??= (real as unknown as { connect(): Promise<unknown> })
      .connect()
      .then(() => undefined)
      .catch((err: Error) => {
        connecting = undefined;
        emit(`[redisCached] connect failed: ${err.message}`);
      });
    let timer: ReturnType<typeof setTimeout> | undefined;
    await Promise.race([
      connecting,
      new Promise<void>((resolve) => {
        timer = setTimeout(resolve, connectTimeoutMs);
        timer.unref();
      }),
    ]);
    if (timer) clearTimeout(timer);
  };

  const lazyMulti = (b: Record<string, unknown>): object => {
    const proxy: object = new Proxy({} as object, {
      get(_s, prop) {
        const v = Reflect.get(b, prop, b) as unknown;
        if (typeof prop !== 'string' || typeof v !== 'function') return v;
        const fn = v as (...a: unknown[]) => unknown;
        if (CACHED_MULTI_RUN.has(prop))
          return (...a: unknown[]) => ready().then(() => fn.apply(b, a));
        return (...a: unknown[]) => {
          const out = fn.apply(b, a);
          return out === b ? proxy : out;
        };
      },
    });
    return proxy;
  };

  const lazyNamespace = (name: string): object =>
    new Proxy({} as object, {
      get(_s, prop) {
        return (...a: unknown[]) =>
          ready().then(() => {
            const ns = (ensure() as unknown as Record<string, Record<string, unknown>>)[name]!;
            return (ns[String(prop)] as (...x: unknown[]) => unknown).apply(ns, a);
          });
      },
    });

  const client: object = new Proxy({} as object, {
    has: (_s, prop) => prop in ensure(),
    get(_s, prop) {
      if (typeof prop !== 'string') return undefined;
      const c = ensure() as unknown as Record<string, unknown>;
      const value = Reflect.get(c, prop, c) as unknown;
      if (CACHED_NAMESPACES.has(prop) && typeof value === 'object' && value !== null)
        return lazyNamespace(prop);
      if (typeof value !== 'function') return value;
      const fn = value as (...a: unknown[]) => unknown;
      if (CACHED_PASSTHROUGH.has(prop)) {
        return (...a: unknown[]) => {
          const out = fn.apply(c, a);
          return out === c ? client : out;
        };
      }
      if (CACHED_LIFECYCLE.has(prop))
        return () => (prop === 'connect' ? Promise.resolve(client) : Promise.resolve());
      if (prop === 'duplicate')
        return () => {
          throw new Error('deps.redisCached cannot be duplicated: use deps.redis.duplicate()');
        };
      if (prop === 'multi' || prop === 'MULTI')
        return (...a: unknown[]) => lazyMulti(fn.apply(c, a) as Record<string, unknown>);
      return (...a: unknown[]) =>
        ready().then(() => {
          const out = fn.apply(ensure(), a);
          return out === ensure() ? client : out;
        });
    },
  });

  return {
    client: client as LearnerRedis,
    get clientSideCache() {
      return csc;
    },
    async close() {
      if (closed) return;
      closed = true;
      if (real) await closeRedis(real);
    },
  };
}

async function closeRedis(client: LearnerRedis): Promise<void> {
  // The fallback timer must be cleared when close() wins, or it fires destroy() on an already closed client two
  // seconds later and that throws ClientClosedError out of the timer (seen by every request that opens a duplicate).
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    if (!client.isOpen) return;
    await Promise.race([
      client.close(),
      new Promise<void>((resolve) => {
        timer = setTimeout(() => {
          try {
            void Promise.resolve(client.destroy()).catch(() => undefined);
          } catch {
            // already closed
          }
          resolve();
        }, 2000);
        timer.unref();
      }),
    ]);
  } catch {
    try {
      void Promise.resolve(client.destroy()).catch(() => undefined);
    } catch {
      // already closed
    }
  } finally {
    if (timer) clearTimeout(timer);
  }
}
