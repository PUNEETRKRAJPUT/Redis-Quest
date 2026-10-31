import { format } from 'node:util';
import { createClient } from 'redis';
import pg from 'pg';
import { countRedis } from './counting.js';
import type { LearnerCounters, LearnerDb, LearnerDeps, LearnerRedis } from './types.js';

export interface CreateLearnerDepsOptions {
  /** Defaults to env REDIS_URL, then redis://localhost:6379. Ignored when `redisClient` is given. */
  redisUrl?: string;
  /** Defaults to env DATABASE_URL, then postgres://quest:quest@localhost:5432/quest. Ignored with `dbPool`. */
  databaseUrl?: string;
  /** Receives every `log(...)` line, already formatted to one string. */
  log?: (line: string) => void;
  /** Reuse an already connected client (the app does this); `close()` will not close it. */
  redisClient?: LearnerRedis;
  /** Reuse a pg pool (the app does this); `close()` will not end it. */
  dbPool?: pg.Pool;
  /** Redis connect timeout in ms (default 3000). */
  connectTimeoutMs?: number;
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
export async function createLearnerDeps(opts: CreateLearnerDepsOptions = {}): Promise<LearnerContext> {
  const counters: LearnerCounters = { redisCommands: 0, dbQueries: 0 };
  const emit = opts.log ?? (() => undefined);
  const log = (...args: unknown[]): void => emit(format(...args));

  const owned: Array<() => Promise<unknown>> = [];

  let rawRedis: LearnerRedis;
  if (opts.redisClient) {
    rawRedis = opts.redisClient;
  } else {
    const created = createClient({
      url: opts.redisUrl ?? process.env.REDIS_URL ?? DEFAULT_REDIS_URL,
      socket: {
        connectTimeout: opts.connectTimeoutMs ?? 3000,
        // Short backoff, then give up so a dead Redis becomes an error the learner can read.
        reconnectStrategy: (retries: number) => (retries < 3 ? 100 : new Error('Redis connection lost')),
      },
    }) as unknown as LearnerRedis;
    created.on('error', (err: Error) => log(`[redis] ${err.message}`));
    await created.connect();
    owned.push(() => closeRedis(created));
    rawRedis = created;
  }

  const redis = countRedis(rawRedis, counters, {
    onDuplicate: (clone) => {
      (clone as { on?: (e: string, f: (err: Error) => void) => void }).on?.('error', (err) =>
        log(`[redis] ${err.message}`),
      );
      owned.push(() => closeRedis(clone as unknown as LearnerRedis));
    },
  });

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
    deps: { redis, db, log },
    counters,
    async close() {
      await Promise.all(owned.splice(0).map((f) => f().catch(() => undefined)));
    },
  };
}

async function closeRedis(client: LearnerRedis): Promise<void> {
  try {
    if (!client.isOpen) return;
    await Promise.race([
      client.close(),
      new Promise<void>((resolve) =>
        setTimeout(() => {
          client.destroy();
          resolve();
        }, 2000).unref(),
      ),
    ]);
  } catch {
    client.destroy();
  }
}
