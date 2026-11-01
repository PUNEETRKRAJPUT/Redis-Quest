import type { Logger } from 'pino';
import type { RedisTarget } from '../redis.js';
import { RequestScope, type SlotRuntime } from '../slots/runtime.js';
import type pg from 'pg';

/**
 * The key rule the ops-wall levels quote: the route key the app reports (`METHOD routerPath`, for example
 * `GET /app/players/:id/stats`) becomes the middle of a Redis key by collapsing every run of spaces and
 * slashes into one underscore:
 *
 *   routeKey('GET /app/players/:id/stats')  ->  'GET_app_players_:id_stats'
 *   ts:requests:GET_app_players_:id_stats   (also ts:errors:<routeKey> and ts:latency:<routeKey>)
 *
 * It is idempotent (an already converted key comes back unchanged), so `ops.range` accepts either form.
 */
export function routeKey(route: string): string {
  return route.replace(/[ /]+/g, '_');
}

/** What `ops.record` receives for one request. `at` is the epoch ms when the request finished. */
export interface OpsSample {
  route: string;
  status: number;
  ms: number;
  at: number;
}

/** Requests the app answers that must not feed the wall: the wall's own reads and the manual sample route. */
const NOT_RECORDED = new Set(['/app/ops/wall', '/app/ops/samples']);

const MAX_IN_FLIGHT = 500;
const LOG_EVERY_MS = 60_000;

export interface OpsHookOptions {
  slots: SlotRuntime;
  redis: RedisTarget;
  /** The pool learner deps see (extra DB latency applied). */
  pool: pg.Pool;
  log: Logger;
}

/**
 * The provided hook behind level 4.16. While slot `ops.record` is active, every counted request calls it
 * once, in the background, after the response is sent: sampling is "every request", not a fraction.
 *
 * Cost, so nobody is surprised: one extra counted learner context and one slot call per request (the
 * learner's own commands, a handful of Redis round trips, run off the request path and are not added to
 * the request's counters). The call is never awaited by the request. At most 500 calls are in flight; beyond
 * that a sample is dropped and counted in `dropped`, so a slow Redis cannot pile up memory. Learner errors
 * are logged once per minute with a count of how many were seen since the last line.
 */
export class OpsHook {
  private inFlight = 0;
  private errors = 0;
  private lastLogAt = 0;
  private lastError = '';
  /** Samples handed to the slot, and samples dropped because too many calls were already running. */
  recorded = 0;
  dropped = 0;

  constructor(private readonly o: OpsHookOptions) {}

  /** Called from the response hook with the route url and the outcome. Never throws, never blocks. */
  onCounted(method: string, url: string, status: number, ms: number): void {
    if (NOT_RECORDED.has(url)) return;
    if (!this.o.slots.active.includes('ops.record')) return;
    if (this.inFlight >= MAX_IN_FLIGHT) {
      this.dropped += 1;
      return;
    }
    this.inFlight += 1;
    this.recorded += 1;
    void this.run({
      route: `${method} ${url}`,
      status,
      ms: Math.round(ms * 1000) / 1000,
      at: Date.now(),
    });
  }

  private async run(sample: OpsSample): Promise<void> {
    let scope: RequestScope | undefined;
    try {
      scope = await RequestScope.create({
        ...this.o.redis.learner,
        pool: this.o.pool,
        log: (line) => this.o.log.info({ learner: true, worker: 'ops.record' }, line),
      });
      await this.o.slots.call(scope, 'ops.record', sample);
    } catch (err) {
      this.noteError(err);
    } finally {
      this.inFlight -= 1;
      if (scope) void scope.close().catch(() => undefined);
    }
  }

  private noteError(err: unknown): void {
    const e = err as {
      learnerError?: { name: string; message: string };
      name?: string;
      message?: string;
    };
    const le = e.learnerError ?? { name: e.name ?? 'Error', message: e.message ?? String(err) };
    this.errors += 1;
    this.lastError = `${le.name}: ${le.message}`;
    const now = Date.now();
    if (now - this.lastLogAt < LOG_EVERY_MS) return;
    this.lastLogAt = now;
    this.o.log.error(
      { slot: 'ops.record', failures: this.errors, err: le },
      `learner code in slot ops.record failed (${this.errors} since the last report, logged once a minute): ${this.lastError}`,
    );
    this.errors = 0;
  }
}
