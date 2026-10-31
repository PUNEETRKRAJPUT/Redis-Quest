import { describe, expect, test } from 'vitest';
import { etagOf, matchesEtag, type AppConfig } from '../src/appconfig.js';
import { MetricsStore, parsePush } from '../src/metrics.js';
import { EventBus } from '../src/events.js';

const cfg: AppConfig = { target: { redisUrl: 'redis://redis:6379' }, activeSlots: ['cache.getPlayerStats'], dbExtraLatencyMs: 0 };

describe('app-config etag', () => {
  test('stable for the same config, changes with any field', () => {
    expect(etagOf(cfg)).toBe(etagOf({ ...cfg }));
    expect(etagOf({ ...cfg, dbExtraLatencyMs: 50 })).not.toBe(etagOf(cfg));
    expect(etagOf({ ...cfg, activeSlots: [] })).not.toBe(etagOf(cfg));
    expect(etagOf({ ...cfg, target: { redisUrl: 'redis://other:6379' } })).not.toBe(etagOf(cfg));
  });
  test('If-None-Match forms', () => {
    const e = etagOf(cfg);
    expect(matchesEtag(`"${e}"`, e)).toBe(true);
    expect(matchesEtag(`W/"${e}"`, e)).toBe(true);
    expect(matchesEtag(`"zzz", "${e}"`, e)).toBe(true);
    expect(matchesEtag('*', e)).toBe(true);
    expect(matchesEtag('"zzz"', e)).toBe(false);
    expect(matchesEtag(undefined, e)).toBe(false);
  });
});

describe('metrics store', () => {
  const route = { count: 10, errors: 1, p50Ms: 5, p99Ms: 20 };
  test('aggregates across instances and expires after 5 minutes', () => {
    const m = new MetricsStore();
    const now = 1_000_000_000_000;
    m.push({ instanceId: 'a', at: now - 2000, routes: { 'GET /x': route } }, now);
    m.push({ instanceId: 'b', at: now - 2000, routes: { 'GET /x': { ...route, p99Ms: 40 } } }, now);
    const s = m.summary(60, now);
    expect(s.instances).toEqual(['a', 'b']);
    expect(s.totals.count).toBe(20);
    expect(s.totals.p99Ms).toBe(40);
    expect(m.summary(60, now + 6 * 60 * 1000).instances).toEqual([]);
  });
  test('rejects bad pushes', () => {
    expect(() => parsePush({ instanceId: 'a', routes: { x: { count: 'no' } } })).toThrow();
    expect(() => parsePush({ routes: {} })).toThrow();
  });
});

describe('event ring', () => {
  test('keeps the last 200 and filters by since', () => {
    const bus = new EventBus();
    for (let i = 0; i < 250; i++) bus.emit('level.event', { kind: 'custom', name: `e${i}` }, new Date(1000 + i));
    bus.emit('progress.changed', {});
    const all = bus.since();
    expect(all).toHaveLength(200);
    expect((all[0]?.data as { name: string }).name).toBe('e50');
    expect(bus.since(new Date(1000 + 240).toISOString())).toHaveLength(10);
  });
});
