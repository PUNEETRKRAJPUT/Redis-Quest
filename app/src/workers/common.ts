import type { Logger } from 'pino';
import type pg from 'pg';
import type { RedisTarget } from '../redis.js';
import { RequestScope, type SlotRuntime } from '../slots/runtime.js';

export const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

export interface BackgroundDeps {
  slots: SlotRuntime;
  redis: RedisTarget;
  /** The pool learner deps see (extra DB latency applied). */
  pool: pg.Pool;
  log: Logger;
}

/**
 * Run a slot outside a request (workers, activation hooks) with the same counted, fail-fast deps a request
 * gets. Returns true when it ran without a learner error; errors are logged, never thrown, so one bad
 * event cannot stop a worker.
 */
export async function callSlotInBackground(
  d: BackgroundDeps,
  name: string,
  ...args: unknown[]
): Promise<boolean> {
  const scope = await RequestScope.create({
    ...d.redis.learner,
    pool: d.pool,
    log: (line) => d.log.info({ learner: true, worker: name }, line),
  });
  try {
    await d.slots.call(scope, name, ...args);
    return true;
  } catch (err) {
    const e = err as {
      name?: string;
      message?: string;
      learnerError?: { name: string; message: string };
    };
    const le = e.learnerError ?? { name: e.name ?? 'Error', message: e.message ?? String(err) };
    d.log.error(
      { slot: name, err: le },
      `learner code in slot ${name} failed: ${le.name}: ${le.message}`,
    );
    return false;
  } finally {
    void scope.close().catch(() => undefined);
  }
}
