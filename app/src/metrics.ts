import { percentile } from '@quest/shared';

/** One route's numbers for one second, as pushed to the engine. */
export interface RouteSecond {
  count: number;
  /** Responses with status >= 500 (a 404 for an unknown player is a correct answer, not an error). */
  errors: number;
  p50Ms: number;
  p99Ms: number;
  /** Sums over the second's requests, counted by the @quest/shared learner proxies. */
  dbQueries: number;
  redisCommands: number;
  /** Requests that made no database query: for a cache slot, the hits. hit ratio = noDbCount / count. */
  noDbCount: number;
  /** Responses carrying x-quest-slot-error. */
  slotErrors: number;
  /** Responses with status 429 (rate limited), for the limiter panel. Additive field. */
  denied: number;
}

export interface Sample {
  ms: number;
  status: number;
  dbQueries: number;
  redisCommands: number;
  slotError: boolean;
  /** True for a 429 response. */
  denied?: boolean;
}

interface Bucket {
  ms: number[];
  errors: number;
  dbQueries: number;
  redisCommands: number;
  noDbCount: number;
  slotErrors: number;
  denied: number;
}

const round = (n: number) => Math.round(n * 1000) / 1000;

/** Running sums since the instance started (served at GET /app/metrics; never reset by drain). */
export interface RouteTotals {
  count: number;
  errors: number;
  dbQueries: number;
  redisCommands: number;
  noDbCount: number;
  slotErrors: number;
  denied: number;
}

/** Collects per-route samples; `drain()` returns the window's numbers and starts a new window. */
export class MetricsRecorder {
  private buckets = new Map<string, Bucket>();
  readonly since = new Date().toISOString();
  readonly totals: Record<string, RouteTotals> = {};

  record(route: string, s: Sample): void {
    const t = (this.totals[route] ??= {
      count: 0,
      errors: 0,
      dbQueries: 0,
      redisCommands: 0,
      noDbCount: 0,
      slotErrors: 0,
      denied: 0,
    });
    t.count += 1;
    if (s.status >= 500) t.errors += 1;
    t.dbQueries += s.dbQueries;
    t.redisCommands += s.redisCommands;
    if (s.dbQueries === 0) t.noDbCount += 1;
    if (s.slotError) t.slotErrors += 1;
    if (s.denied) t.denied += 1;

    let b = this.buckets.get(route);
    if (!b) {
      b = {
        ms: [],
        errors: 0,
        dbQueries: 0,
        redisCommands: 0,
        noDbCount: 0,
        slotErrors: 0,
        denied: 0,
      };
      this.buckets.set(route, b);
    }
    b.ms.push(s.ms);
    if (s.status >= 500) b.errors += 1;
    b.dbQueries += s.dbQueries;
    b.redisCommands += s.redisCommands;
    if (s.dbQueries === 0) b.noDbCount += 1;
    if (s.slotError) b.slotErrors += 1;
    if (s.denied) b.denied += 1;
  }

  drain(): Record<string, RouteSecond> {
    const out: Record<string, RouteSecond> = {};
    for (const [route, b] of this.buckets) {
      const sorted = b.ms.sort((x, y) => x - y);
      out[route] = {
        count: sorted.length,
        errors: b.errors,
        p50Ms: round(percentile(sorted, 50)),
        p99Ms: round(percentile(sorted, 99)),
        dbQueries: b.dbQueries,
        redisCommands: b.redisCommands,
        noDbCount: b.noDbCount,
        slotErrors: b.slotErrors,
        denied: b.denied,
      };
    }
    this.buckets = new Map();
    return out;
  }
}
