import { describe, expect, test } from 'vitest';
import { callRoute, parseSlotsHeader, runMany, servedFrom } from '../src/features/phone/request';
import { dotPositions, summarizeSpread } from '../src/features/phone/spread';
import { parseTraceHeader, type TraceRow } from '../src/features/phone/trace';
import { errorCopy, viewFor } from '../src/features/phone/views';
import {
  MIN_BAR_PCT,
  formatMs,
  layoutWaterfall,
  summarizeTrace,
} from '../src/features/phone/waterfall';

const row = (startMs: number, ms: number, kind: 'redis' | 'db' = 'redis'): TraceRow => ({
  kind,
  label: 'GET k',
  startMs,
  ms,
  by: 'builtin',
  ok: true,
});

describe('parseTraceHeader', () => {
  const good = JSON.stringify({
    v: 1,
    total: 12.3,
    n: 3,
    e: [
      ['r', 'GET k', 0.1, 0.4, 'b', 1],
      ['d', 'SELECT 1', 1, 9, 'l', 0],
    ],
  });

  test('reads rows, who ran and whether each call worked', () => {
    const t = parseTraceHeader(good);
    expect(t?.totalMs).toBe(12.3);
    expect(t?.calls).toBe(3);
    expect(t?.rows).toEqual([
      { kind: 'redis', label: 'GET k', startMs: 0.1, ms: 0.4, by: 'builtin', ok: true },
      { kind: 'db', label: 'SELECT 1', startMs: 1, ms: 9, by: 'learner', ok: false },
    ]);
  });

  test('anything unreadable is no trace', () => {
    expect(parseTraceHeader(null)).toBeNull();
    expect(parseTraceHeader('')).toBeNull();
    expect(parseTraceHeader('not json')).toBeNull();
    expect(parseTraceHeader('{"v":2,"e":[]}')).toBeNull();
    expect(parseTraceHeader('[1]')).toBeNull();
  });

  test('a bad row is skipped, the rest are kept', () => {
    const t = parseTraceHeader(
      '{"v":1,"total":1,"n":2,"e":[["x","a",0,1,"b",1],["r","b",0,1,"b",1]]}',
    );
    expect(t?.rows).toHaveLength(1);
    expect(t?.calls).toBe(2);
  });
});

describe('layoutWaterfall', () => {
  test('ten round trips are ten bars, one pipeline is one', () => {
    const ten = Array.from({ length: 10 }, (_, i) => row(i * 2, 1.5));
    expect(layoutWaterfall(ten, 21).bars).toHaveLength(10);
    expect(layoutWaterfall([row(0, 3)], 4).bars).toHaveLength(1);
  });

  test('positions are percentages of the span and stay inside the strip', () => {
    const l = layoutWaterfall([row(0, 5), row(5, 5)], 10);
    expect(l.spanMs).toBe(10);
    expect(l.bars[0]).toMatchObject({ leftPct: 0, widthPct: 50 });
    expect(l.bars[1]).toMatchObject({ leftPct: 50, widthPct: 50 });
  });

  test('the span grows to the last call when the total is shorter, and a tiny call stays visible', () => {
    const l = layoutWaterfall([row(0, 0.01), row(9, 5)], 3);
    expect(l.spanMs).toBe(14);
    expect(l.bars[0]?.widthPct).toBe(MIN_BAR_PCT);
    const b = l.bars[1];
    expect((b?.leftPct ?? 0) + (b?.widthPct ?? 0)).toBeLessThanOrEqual(100.000001);
  });

  test('no rows still gives a usable axis', () => {
    const l = layoutWaterfall([], 0);
    expect(l.bars).toEqual([]);
    expect(l.ticks).toHaveLength(5);
  });

  test('formatMs picks a readable unit', () => {
    expect(formatMs(0.44)).toBe('0.4 ms');
    expect(formatMs(42.4)).toBe('42 ms');
    expect(formatMs(1500)).toBe('1.50 s');
  });
});

describe('summarizeTrace', () => {
  test('counts by kind and sees sequential calls', () => {
    const s = summarizeTrace([row(0, 2), row(2, 2, 'db'), row(5, 1)]);
    expect(s).toMatchObject({ redis: 2, db: 1, sequential: true, busyMs: 5 });
  });

  test('overlapping calls count once in busy time and are not sequential', () => {
    const s = summarizeTrace([row(0, 4), row(1, 4), row(2, 4)]);
    expect(s.sequential).toBe(false);
    expect(s.busyMs).toBe(6);
  });
});

describe('spread of many requests', () => {
  test('min, median, p90, max and mean', () => {
    const s = summarizeSpread([5, 1, 3, 2, 4, 10, 6, 7, 8, 9]);
    expect(s).toEqual({ n: 10, minMs: 1, p50Ms: 5, p90Ms: 9, maxMs: 10, meanMs: 5.5 });
  });

  test('one sample, and none', () => {
    expect(summarizeSpread([7])).toMatchObject({ n: 1, minMs: 7, p50Ms: 7, p90Ms: 7, maxMs: 7 });
    expect(summarizeSpread([])).toBeNull();
  });

  test('the dots run from fastest (0) to slowest (100); identical samples sit in the middle', () => {
    expect(dotPositions([10, 20, 30])).toEqual([0, 50, 100]);
    expect(dotPositions([4, 4])).toEqual([50, 50]);
    expect(dotPositions([])).toEqual([]);
  });
});

describe('request', () => {
  test('slots header: pairs, who answered', () => {
    const p = parseSlotsHeader('cache.getPlayerStats=learner, x=baseline');
    expect(p).toEqual([
      { slot: 'cache.getPlayerStats', path: 'learner' },
      { slot: 'x', path: 'baseline' },
    ]);
    expect(servedFrom(p)).toBe('learner');
    expect(servedFrom(parseSlotsHeader('a=baseline'))).toBe('builtin');
    expect(servedFrom(parseSlotsHeader('a=baseline-load-error'))).toBe('fallback');
    expect(servedFrom(parseSlotsHeader(null))).toBe('builtin');
  });

  const fakeFetch =
    (res: Response | Error): typeof fetch =>
    () =>
      res instanceof Error ? Promise.reject(res) : Promise.resolve(res);
  const clock = () => {
    let t = 0;
    return () => (t += 10);
  };

  test('a good answer carries the status, the trace and which version ran', async () => {
    const res = new Response(JSON.stringify({ name: 'Asha' }), {
      status: 200,
      headers: {
        'x-quest-slots': 'cache.getPlayerStats=learner',
        'x-quest-instance': 'app-1',
        'x-quest-trace': '{"v":1,"total":2,"n":1,"e":[["r","GET k",0,1,"l",1]]}',
      },
    });
    const r = await callRoute('/app/x', { fetch: fakeFetch(res), now: clock(), timeoutMs: 1000 });
    expect(r).toMatchObject({
      status: 200,
      ok: true,
      served: 'learner',
      slots: ['cache.getPlayerStats'],
      instance: 'app-1',
      ms: 10,
    });
    expect(r.trace?.rows).toHaveLength(1);
  });

  test('an error answer keeps the status and the app code', async () => {
    const res = new Response(JSON.stringify({ error: 'player_not_found' }), { status: 404 });
    const r = await callRoute('/app/x', { fetch: fakeFetch(res), now: clock(), timeoutMs: 1000 });
    expect(r).toMatchObject({ status: 404, ok: false, errorCode: 'player_not_found' });
  });

  test('a dead stack is a result with status 0, not a throw', async () => {
    const r = await callRoute('/app/x', {
      fetch: fakeFetch(new TypeError('fetch failed')),
      now: clock(),
      timeoutMs: 1000,
    });
    expect(r).toMatchObject({ status: 0, ok: false, errorCode: 'unreachable' });
  });

  test('runMany runs one after another and reports each', async () => {
    const seen: number[] = [];
    const out = await runMany(
      '/p',
      3,
      async (path) => ({
        path,
        status: 200,
        ok: true,
        ms: seen.length,
        body: null,
        served: 'builtin',
        slots: [],
        trace: null,
      }),
      (_r, i) => seen.push(i),
    );
    expect(out.map((r) => r.ms)).toEqual([0, 1, 2]);
    expect(seen).toEqual([0, 1, 2]);
  });
});

describe('views', () => {
  test('player: name as heading, scalar fields as rows', () => {
    const v = viewFor('player', { name: 'Asha', runs: 120, nested: { a: 1 } });
    expect(v).toEqual({
      kind: 'fields',
      heading: 'Asha',
      fields: [{ label: 'runs', value: '120' }],
    });
  });

  test('fixtures list uses team names when the row has them, ids otherwise', () => {
    const v = viewFor('fixtures', {
      fixtures: [{ home_team_id: 't-1', away_team_id: 't-2', venue: 'Eden', status: 'live' }],
    });
    expect(v).toEqual({
      kind: 'list',
      items: [{ title: 't-1 v t-2', sub: 'Eden / live' }],
      empty: 'No fixtures right now.',
    });
  });

  test('leaderboard rows keep rank, team and points', () => {
    const v = viewFor('board', {
      entries: [{ rank: 1, teamId: 'ft-9', userId: 'u-1', points: 88 }],
    });
    expect(v).toMatchObject({
      kind: 'list',
      items: [{ title: '1. ft-9', sub: 'u-1', trailing: '88' }],
    });
  });

  test('a shape nobody planned for falls back to raw text', () => {
    expect(viewFor('fixtures', 'oops')).toEqual({ kind: 'raw', text: '"oops"' });
    expect(viewFor('board', null).kind).toBe('raw');
  });

  test('errors read like an app, with the status', () => {
    expect(errorCopy(500, 'slot_error')).toEqual({
      title: 'Something went wrong',
      detail: '500 slot_error',
    });
    expect(errorCopy(404, 'player_not_found').title).toBe('Not found');
    expect(errorCopy(0, undefined).title).toBe('No connection');
  });
});
