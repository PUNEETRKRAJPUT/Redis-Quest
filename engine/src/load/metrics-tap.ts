// Sums the app's per-second metric pushes over a load run's window.
//
// GET /api/metrics sums over "the last N seconds"; a load run needs its own exact window (the run
// started and finished at known times), so the verifier listens to every push (MetricsStore.onPush)
// and sums dbQueries, redisCommands and noDbCount (app/src/metrics.ts) per window itself.

import type { MetricsPush, MetricsStore } from '../metrics.js';

interface Tapped {
  at: number;
  instanceId: string;
  routes: MetricsPush['routes'];
}

export interface AppWindow {
  instances: string[];
  requests: number;
  errors: number;
  dbQueries: number;
  redisCommands: number;
  noDbCount: number;
  slotErrors: number;
  /** Postgres queries per app request. */
  dbPerRequest: number;
  /** Requests that made no Postgres query, divided by all requests (app/src/metrics.ts noDbCount). */
  hitRatio: number;
  seconds: number;
}

const KEEP_MS = 6 * 60 * 1000;
/** Routes that are not scenario traffic (health probes from the verifier itself). */
const IGNORED_ROUTE = /\/health\b/;

export class MetricsTap {
  private pushes: Tapped[] = [];

  attach(store: Pick<MetricsStore, 'onPush'>): void {
    store.onPush((p, now) => this.record(p, now));
  }

  record(p: MetricsPush, now = Date.now()): void {
    const at = Math.floor((p.at ?? now) / 1000) * 1000;
    const existing = this.pushes.find((x) => x.instanceId === p.instanceId && x.at === at);
    if (existing) existing.routes = p.routes;
    else this.pushes.push({ at, instanceId: p.instanceId, routes: p.routes });
    const cutoff = now - KEEP_MS;
    while (this.pushes.length && (this.pushes[0]?.at ?? 0) < cutoff) this.pushes.shift();
  }

  /** Sums every push whose second lies in [fromMs, toMs]. Null when nothing was pushed in the window. */
  window(fromMs: number, toMs: number): AppWindow | null {
    const inWindow = this.pushes.filter((p) => p.at >= fromMs && p.at <= toMs);
    const sum = { requests: 0, errors: 0, dbQueries: 0, redisCommands: 0, noDbCount: 0, slotErrors: 0 };
    const instances = new Set<string>();
    const seconds = new Set<number>();
    for (const p of inWindow) {
      for (const [route, s] of Object.entries(p.routes)) {
        if (IGNORED_ROUTE.test(route)) continue;
        instances.add(p.instanceId);
        seconds.add(p.at);
        sum.requests += s.count ?? 0;
        sum.errors += s.errors ?? 0;
        sum.dbQueries += s.dbQueries ?? 0;
        sum.redisCommands += s.redisCommands ?? 0;
        sum.noDbCount += s.noDbCount ?? 0;
        sum.slotErrors += s.slotErrors ?? 0;
      }
    }
    if (sum.requests === 0) return null;
    const r4 = (n: number) => Math.round(n * 10000) / 10000;
    return {
      instances: [...instances].sort(),
      ...sum,
      dbPerRequest: r4(sum.dbQueries / sum.requests),
      hitRatio: r4(sum.noDbCount / sum.requests),
      seconds: seconds.size,
    };
  }
}
