import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, test } from 'vitest';
import type { TrafficVerifier } from '@quest/shared';
import { BaselineStore, fingerprintDiff, type RunSummary } from '../src/load/baseline.js';
import { MetricsTap } from '../src/load/metrics-tap.js';
import type { LoadRunResult, RunLoadOptions } from '../src/load/run.js';
import { loadCaps, type VerifyConfig } from '../src/verify/config.js';
import { evaluateTraffic, trafficMessage, TrafficRunner, type AppControl } from '../src/verify/traffic.js';

function load(p: Partial<LoadRunResult>): LoadRunResult {
  return {
    startedAt: 0, finishedAt: 0, durationSec: 10, connections: 50, responses: 1000, ok2xx: 1000, non2xx: 0, status5xx: 0,
    connErrors: 0, timeouts: 0, p50Ms: 10, p99Ms: 100, rps: 100, errorRate: 0, statusCodes: {}, ...p,
  };
}
const app = (requests: number, dbQueries: number, noDbCount: number) => ({
  instances: ['a'], requests, errors: 0, dbQueries, redisCommands: 0, noDbCount, slotErrors: 0,
  dbPerRequest: dbQueries / requests, hitRatio: noDbCount / requests, seconds: 10,
});

const baseline: RunSummary = { load: load({ p99Ms: 2000, rps: 40 }), app: app(400, 400, 0) };
const good: RunSummary = { load: load({ p99Ms: 20, rps: 3000 }), app: app(30000, 3, 29997) };

describe('evaluateTraffic', () => {
  test('ratio assertions against the baseline, db calls per request', () => {
    const v = evaluateTraffic({ p99_ratio_lte: 0.2, db_calls_ratio_lte: 0.1, rps_ratio_gte: 2 }, good, baseline);
    expect(v.every((x) => x.ok)).toBe(true);
    expect(v.find((x) => x.key === 'p99_ratio_lte')?.text).toBe('p99 ratio 0.01 (20 ms now vs 2000 ms baseline), needs at most 0.2');
  });
  test('no improvement fails with numbers', () => {
    const same: RunSummary = { load: load({ p99Ms: 1900, rps: 42 }), app: app(420, 420, 0) };
    const v = evaluateTraffic({ p99_ratio_lte: 0.2, db_calls_ratio_lte: 0.1 }, same, baseline);
    const { ok, message } = trafficMessage({ message: 'Not faster.' }, v);
    expect(ok).toBe(false);
    expect(message).toBe(
      'Not faster. (p99 ratio 0.95 (1900 ms now vs 2000 ms baseline), needs at most 0.2; Postgres calls per request ratio 1 (1 per request now vs 1 baseline), needs at most 0.1)',
    );
  });
  test('absolute assertions need no baseline', () => {
    const v = evaluateTraffic({ hit_ratio_gte: 0.9, error_rate_lte: 0, db_queries_lte: 2, p99_ms_lte: 50 }, good, null);
    expect(v.map((x) => [x.key, x.ok])).toEqual([
      ['hit_ratio_gte', true],
      ['error_rate_lte', true],
      ['db_queries_lte', false],
      ['p99_ms_lte', true],
    ]);
  });
  test('fast errors never pass: implicit 1% error ceiling, and zero successes fail', () => {
    const errors: RunSummary = { load: load({ p99Ms: 2, errorRate: 0.5, status5xx: 500 }), app: app(1000, 0, 1000) };
    const v = evaluateTraffic({ p99_ratio_lte: 0.2 }, errors, baseline);
    expect(v.find((x) => x.key === 'p99_ratio_lte')?.ok).toBe(true);
    expect(v.find((x) => x.key === 'error_rate')?.ok).toBe(false);
    expect(trafficMessage({}, v).ok).toBe(false);
    const none: RunSummary = { load: load({ ok2xx: 0, p99Ms: 1 }), app: null };
    expect(evaluateTraffic({ p99_ms_lte: 50 }, none, null).find((x) => x.key === 'requests')?.ok).toBe(false);
  });
  test('missing app metrics fail db-based assertions instead of passing', () => {
    const noApp: RunSummary = { load: good.load, app: null };
    const v = evaluateTraffic({ db_calls_ratio_lte: 0.1, hit_ratio_gte: 0.5, db_queries_lte: 100 }, noApp, baseline);
    expect(v.filter((x) => !x.ok).map((x) => x.key)).toEqual(['db_calls_ratio_lte', 'hit_ratio_gte', 'db_queries_lte']);
  });
});

describe('MetricsTap', () => {
  test('sums additive fields over a window, ignoring health probes', () => {
    const tap = new MetricsTap();
    const route = (count: number, db: number, noDb: number) => ({ count, errors: 0, p50Ms: 1, p99Ms: 2, dbQueries: db, redisCommands: count, noDbCount: noDb, slotErrors: 0 });
    tap.record({ instanceId: 'a', at: 1000, routes: { 'GET /app/players/:id/stats': route(10, 10, 0) } }, 1000);
    tap.record({ instanceId: 'b', at: 2000, routes: { 'GET /app/players/:id/stats': route(30, 0, 30), 'GET /app/health': route(5, 0, 5) } }, 2000);
    tap.record({ instanceId: 'a', at: 9000, routes: { 'GET /app/x': route(99, 99, 0) } }, 9000);
    const w = tap.window(1000, 2500);
    expect(w).toMatchObject({ requests: 40, dbQueries: 10, noDbCount: 30, hitRatio: 0.75, dbPerRequest: 0.25, instances: ['a', 'b'] });
    expect(tap.window(3000, 4000)).toBeNull();
  });
});

describe('TrafficRunner with fakes', () => {
  let dir = '';
  afterEach(() => dir && rmSync(dir, { recursive: true, force: true }));

  function setup(opts: { baselineFails?: boolean } = {}) {
    dir = mkdtempSync(join(tmpdir(), 'p09-traffic-'));
    const cfg: VerifyConfig = {
      runnerUrl: '', appUrl: 'http://proxy:3000/app', scenariosDir: join(__dirname, '../../scenarios'), baselinesDir: join(dir, 'baselines'),
      engineApi: 'http://127.0.0.1:4200/api', caps: loadCaps({}), maxEventWaitMs: null,
    };
    let active: string[] = ['session.get'];
    const switches: string[][] = [];
    const appCtl: AppControl = {
      getConfig: async () => ({ activeSlots: [...active], dbExtraLatencyMs: 0 }),
      setSlots: async (s) => {
        active = [...s];
        switches.push([...s]);
      },
      waitForSlots: async () => undefined,
    };
    const tap = new MetricsTap();
    const runs: RunLoadOptions[] = [];
    const runLoad = async (o: RunLoadOptions): Promise<LoadRunResult> => {
      runs.push(o);
      const cached = active.includes('cache.getPlayerStats');
      const now = Date.now();
      const r = cached ? load({ p99Ms: 15, rps: 2000 }) : load({ p99Ms: 2500, rps: 40, ...(opts.baselineFails ? { ok2xx: 0, errorRate: 1 } : {}) });
      const at = Math.floor(now / 1000) * 1000;
      tap.record({ instanceId: 'app-1', at, routes: { 'GET /app/players/:id/stats': { count: 100, errors: 0, p50Ms: 1, p99Ms: 1, dbQueries: cached ? 1 : 100, noDbCount: cached ? 99 : 0 } } }, now);
      return { ...r, startedAt: now, finishedAt: now };
    };
    const t = new TrafficRunner({ cfg, tap, baselines: new BaselineStore(cfg.baselinesDir), runLoad, app: appCtl, sleep: async () => undefined });
    return { t, switches, runs, getActive: () => active, cfg };
  }

  const v: TrafficVerifier = { type: 'traffic', scenario: 'toss-time-100', baseline: true, assertions: { p99_ratio_lte: 0.2, db_calls_ratio_lte: 0.1 } };

  test('records the baseline with the level slot off, grades with it on, restores the slots, then reuses the baseline', async () => {
    const { t, switches, runs, getActive } = setup();
    const g1 = await t.grade(v, ['cache.getPlayerStats']);
    expect(g1.ok).toBe(true);
    expect(switches[0]).toEqual(['session.get']); // baseline: level slot off, others kept
    expect(switches[1]).toEqual(['cache.getPlayerStats', 'session.get']); // graded run
    expect(getActive()).toEqual(['session.get']); // restored
    expect(runs.filter((r) => r.connections === 5)).toHaveLength(2); // a warmup before each measured run
    expect((g1.details.baseline as { reused: boolean }).reused).toBe(false);
    const g2 = await t.grade(v, ['cache.getPlayerStats']);
    expect((g2.details.baseline as { reused: boolean }).reused).toBe(true);
    expect(runs).toHaveLength(6);
  });
  test('a learner file that does nothing grades against the same numbers as the baseline and fails', async () => {
    const { t } = setup();
    const g = await t.grade(v, ['cache.nothing']);
    expect(g.ok).toBe(false);
    expect(g.message).toMatch(/^Under load the app did not reach the target\. \(p99 ratio 1/);
  });
  test('a failed baseline run is never stored', async () => {
    const { t, cfg } = setup({ baselineFails: true });
    await expect(t.grade(v, ['cache.getPlayerStats'])).rejects.toThrow(/baseline run of toss-time-100 failed/);
    expect(await new BaselineStore(cfg.baselinesDir).read('toss-time-100')).toBeNull();
  });
  test('fingerprint changes re-record', () => {
    const a = { scenarioHash: 'x', activeSlots: [], dbExtraLatencyMs: 0, connections: 50, durationSec: 10, appUrl: 'u' };
    expect(fingerprintDiff(a, { ...a })).toEqual([]);
    expect(fingerprintDiff(a, { ...a, dbExtraLatencyMs: 50, activeSlots: ['s'] })).toEqual(['activeSlots', 'dbExtraLatencyMs']);
  });
});

describe('MetricsStore sums additive fields and notifies listeners', () => {
  test('summary totals include dbQueries, redisCommands, noDbCount', async () => {
    const { MetricsStore } = await import('../src/metrics.js');
    const m = new MetricsStore();
    const tap = new MetricsTap();
    tap.attach(m);
    const now = Date.now();
    m.push({ instanceId: 'a', at: now, routes: { 'GET /x': { count: 4, errors: 0, p50Ms: 1, p99Ms: 2, dbQueries: 1, redisCommands: 8, noDbCount: 3 } } }, now);
    m.push({ instanceId: 'b', at: now, routes: { 'GET /x': { count: 6, errors: 1, p50Ms: 1, p99Ms: 5, dbQueries: 6, redisCommands: 0, noDbCount: 0 } } }, now);
    expect(m.summary(60, now).totals).toMatchObject({ count: 10, dbQueries: 7, redisCommands: 8, noDbCount: 3, slotErrors: 0 });
    expect(tap.window(now - 1000, now + 1000)).toMatchObject({ requests: 10, dbQueries: 7, noDbCount: 3 });
  });
});
