import pg from 'pg';
import type { Logger } from 'pino';

export function createPool(databaseUrl: string, log: Logger): pg.Pool {
  const pool = new pg.Pool({ connectionString: databaseUrl, max: 20, connectionTimeoutMillis: 5000 });
  pool.on('error', (err) => log.warn({ err: err.message }, 'postgres pool error'));
  return pool;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * The pool as learner deps see it: same `query`, with the engine's `dbExtraLatencyMs` added before every
 * call (the one artificial "database in another region" level). Only `query` is used by
 * `createLearnerDeps`, so only `query` is provided.
 */
export function latencyPool(pool: pg.Pool, extraMs: () => number): pg.Pool {
  const wrapped = {
    async query(text: string, params?: unknown[]) {
      const ms = extraMs();
      if (ms > 0) await sleep(ms);
      return pool.query(text, params);
    },
  };
  return wrapped as unknown as pg.Pool;
}
