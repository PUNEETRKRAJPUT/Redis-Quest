// Per-second route metrics pushed by app instances (POST /internal/metrics). Kept for 5 minutes in memory.

export const METRICS_WINDOW_MS = 5 * 60 * 1000;

export interface RouteStat {
  count: number;
  errors: number;
  p50Ms: number;
  p99Ms: number;
  [extra: string]: number;
}

export interface MetricsPush {
  instanceId: string;
  /** Epoch milliseconds of the second being reported; defaults to now. */
  at?: number;
  routes: Record<string, RouteStat>;
}

interface Sample {
  at: number;
  routes: Record<string, RouteStat>;
}

export function parsePush(body: unknown): MetricsPush {
  if (!body || typeof body !== 'object') throw new Error('body must be an object');
  const b = body as Record<string, unknown>;
  if (typeof b.instanceId !== 'string' || !b.instanceId || b.instanceId.length > 100)
    throw new Error('instanceId must be a non-empty string');
  if (b.at !== undefined && (typeof b.at !== 'number' || !Number.isFinite(b.at)))
    throw new Error('at must be epoch milliseconds');
  if (!b.routes || typeof b.routes !== 'object' || Array.isArray(b.routes))
    throw new Error('routes must be an object');
  const routes: Record<string, RouteStat> = {};
  for (const [name, v] of Object.entries(b.routes as Record<string, unknown>)) {
    if (!v || typeof v !== 'object') throw new Error(`routes.${name} must be an object`);
    const s = v as Record<string, unknown>;
    for (const k of ['count', 'errors', 'p50Ms', 'p99Ms']) {
      if (typeof s[k] !== 'number' || !Number.isFinite(s[k]))
        throw new Error(`routes.${name}.${k} must be a number`);
    }
    const stat: Record<string, number> = {};
    for (const [k, val] of Object.entries(s))
      if (typeof val === 'number' && Number.isFinite(val)) stat[k] = val;
    routes[name] = stat as RouteStat;
  }
  return { instanceId: b.instanceId, at: b.at as number | undefined, routes };
}

export interface Aggregate {
  count: number;
  errors: number;
  p50Ms: number;
  p99Ms: number;
  /** Sums of the additive per-request counters the app pushes (P0-07); 0 when no instance sent them. */
  dbQueries: number;
  redisCommands: number;
  noDbCount: number;
  slotErrors: number;
}

/** Fields that add up across seconds and instances (unlike percentiles). */
export const ADDITIVE_FIELDS = ['dbQueries', 'redisCommands', 'noDbCount', 'slotErrors'] as const;

function aggregate(stats: RouteStat[]): Aggregate {
  let count = 0;
  let errors = 0;
  let p50w = 0;
  let p99 = 0;
  const sums = { dbQueries: 0, redisCommands: 0, noDbCount: 0, slotErrors: 0 };
  for (const s of stats) {
    count += s.count;
    errors += s.errors;
    p50w += s.p50Ms * s.count;
    p99 = Math.max(p99, s.p99Ms);
    for (const f of ADDITIVE_FIELDS) sums[f] += s[f] ?? 0;
  }
  return { count, errors, p50Ms: count ? round(p50w / count) : 0, p99Ms: round(p99), ...sums };
}

const round = (n: number) => Math.round(n * 100) / 100;

export class MetricsStore {
  private byInstance = new Map<string, Sample[]>();
  private pushListeners = new Set<(p: MetricsPush, now: number) => void>();

  /** Called after every accepted push (the verifier sums a load run's exact window from these). */
  onPush(fn: (p: MetricsPush, now: number) => void): () => void {
    this.pushListeners.add(fn);
    return () => this.pushListeners.delete(fn);
  }

  push(p: MetricsPush, now = Date.now()): void {
    const at = Math.floor((p.at ?? now) / 1000) * 1000;
    const list = this.byInstance.get(p.instanceId) ?? [];
    const existing = list.find((s) => s.at === at);
    if (existing) existing.routes = p.routes;
    else list.push({ at, routes: p.routes });
    this.byInstance.set(p.instanceId, list);
    this.prune(now);
    for (const l of this.pushListeners) {
      try {
        l(p, now);
      } catch {
        // a listener must never break metric ingestion
      }
    }
  }

  private prune(now: number): void {
    for (const [id, list] of this.byInstance) {
      const kept = list.filter((s) => s.at >= now - METRICS_WINDOW_MS);
      if (kept.length === 0) this.byInstance.delete(id);
      else this.byInstance.set(id, kept);
    }
  }

  /**
   * Aggregate across instances. p50 is the count-weighted mean of instance p50s and p99 is the highest
   * instance p99 (percentiles cannot be merged exactly from summaries); both are approximations.
   */
  summary(seconds = 60, now = Date.now()) {
    this.prune(now);
    const since = now - Math.min(Math.max(seconds, 1), 300) * 1000;
    const buckets = new Map<number, RouteStat[]>();
    const routeStats = new Map<string, RouteStat[]>();
    for (const list of this.byInstance.values()) {
      for (const s of list) {
        if (s.at < since) continue;
        for (const [route, stat] of Object.entries(s.routes)) {
          (buckets.get(s.at) ?? buckets.set(s.at, []).get(s.at)!).push(stat);
          (routeStats.get(route) ?? routeStats.set(route, []).get(route)!).push(stat);
        }
      }
    }
    const series = [...buckets.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([at, stats]) => ({ at: new Date(at).toISOString(), ...aggregate(stats) }));
    const routes: Record<string, Aggregate> = {};
    for (const [route, stats] of routeStats) routes[route] = aggregate(stats);
    const all = [...buckets.values()].flat();
    const total = aggregate(all);
    const spanSeconds = series.length || 1;
    return {
      windowSeconds: Math.min(Math.max(seconds, 1), 300),
      instances: [...this.byInstance.keys()].sort(),
      totals: { ...total, rps: round(total.count / spanSeconds) },
      routes,
      series,
    };
  }

  /** The most recent complete second across all instances, for the `metrics.tick` event. */
  tick(now = Date.now()) {
    const at = Math.floor(now / 1000) * 1000 - 1000;
    const stats: RouteStat[] = [];
    const routes: Record<string, RouteStat[]> = {};
    const instances: string[] = [];
    for (const [id, list] of this.byInstance) {
      const s = list.find((x) => x.at === at);
      if (!s) continue;
      instances.push(id);
      for (const [route, stat] of Object.entries(s.routes)) {
        stats.push(stat);
        (routes[route] ??= []).push(stat);
      }
    }
    if (stats.length === 0) return null;
    return {
      at: new Date(at).toISOString(),
      instances: instances.sort(),
      ...aggregate(stats),
      routes: Object.fromEntries(Object.entries(routes).map(([r, s]) => [r, aggregate(s)])),
    };
  }
}
