// Shared types for the learner-code runtime (P0-08). Names avoid the `level*` prefix used by P0-05.

/** Mutable counters filled in by the counting proxies. See docs/handoffs/P0-08.md for the exact rules. */
export interface LearnerCounters {
  /** Logical Redis commands: one per command-method call, one per executed multi(). */
  redisCommands: number;
  /** One per `db.query` call, including calls that fail. */
  dbQueries: number;
}

/** The thin database handle a learner module receives. */
export interface LearnerDb {
  query(text: string, params?: unknown[]): Promise<{ rows: unknown[] }>;
}

/** A node-redis v5 client (counting proxy around the real one). Typed loosely on purpose. */
export type LearnerRedis = import('redis').RedisClientType<any, any, any, any, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

export interface LearnerDeps {
  redis: LearnerRedis;
  db: LearnerDb;
  log: (...args: unknown[]) => void;
}

export interface LearnerError {
  name: string;
  message: string;
  stack?: string;
}

/** Result of one learner call. `value` is always JSON-safe. */
export interface LearnerCallResult {
  ok: boolean;
  value?: unknown;
  error?: LearnerError;
  ms: number;
}

export interface LearnerMetrics {
  calls: number;
  errors: number;
  p50Ms: number;
  p99Ms: number;
  dbQueries: number;
  redisCommands: number;
  totalMs: number;
}

export type LearnerFn = (deps: LearnerDeps, ...args: unknown[]) => unknown;
