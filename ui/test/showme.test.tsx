import { renderToStaticMarkup } from 'react-dom/server';
import { expect, test } from 'vitest';
import {
  bitfieldArgs,
  infoField,
  isShowMeId,
  renderKey,
  routeTickSeries,
  SHOW_ME_IDS,
  STATS_ROUTE,
} from '../src/showme';
import { SAMPLE } from '../src/showme/sample';
import {
  BitmapStreakView,
  CacheStatsView,
  currentStreak,
  fmtDuration,
  GeoMapView,
  HashCardView,
  HllCounterView,
  JsonTreeView,
  KvCardView,
  LeaderboardPanelView,
  ListFeedView,
  OtpLimiterView,
  SetChipsView,
  StatsLatencyView,
  StreamLogView,
  TtlTimerView,
} from '../src/showme/views';

const s = SAMPLE;

test('fourteen ids, matching the spec', () => {
  expect([...SHOW_ME_IDS]).toEqual([
    'kv_card',
    'hash_card',
    'list_feed',
    'set_chips',
    'leaderboard_panel',
    'ttl_timer',
    'bitmap_streak',
    'hll_counter',
    'geo_map',
    'stream_log',
    'json_tree',
    'cache_stats',
    'stats_latency_panel',
    'otp_limiter_panel',
  ]);
  expect(isShowMeId('geo_map')).toBe(true);
  expect(isShowMeId('nope')).toBe(false);
});

test('every view renders with its sample and carries its id', () => {
  const html: Record<string, string> = {
    kv_card: renderToStaticMarkup(<KvCardView {...s.kv} />),
    hash_card: renderToStaticMarkup(<HashCardView {...s.hash} />),
    list_feed: renderToStaticMarkup(<ListFeedView {...s.list} />),
    set_chips: renderToStaticMarkup(<SetChipsView {...s.set} />),
    leaderboard_panel: renderToStaticMarkup(<LeaderboardPanelView {...s.board} />),
    ttl_timer: renderToStaticMarkup(<TtlTimerView {...s.ttl} readAt={Date.now()} />),
    bitmap_streak: renderToStaticMarkup(<BitmapStreakView {...s.streak} />),
    hll_counter: renderToStaticMarkup(<HllCounterView {...s.hll} />),
    geo_map: renderToStaticMarkup(<GeoMapView {...s.geo} />),
    stream_log: renderToStaticMarkup(<StreamLogView {...s.stream} />),
    json_tree: renderToStaticMarkup(<JsonTreeView {...s.json} />),
    cache_stats: renderToStaticMarkup(<CacheStatsView {...s.cache} />),
    stats_latency_panel: renderToStaticMarkup(<StatsLatencyView {...s.stats} />),
    otp_limiter_panel: renderToStaticMarkup(<OtpLimiterView {...s.limiter} />),
  };
  for (const id of SHOW_ME_IDS) expect(html[id]).toContain(`data-showme="${id}"`);
  expect(html.kv_card).toContain('483921');
  expect(html.leaderboard_panel).toContain('user:teja');
  expect(html.cache_stats).toContain('94.0% hit');
});

test('empty and edge states do not throw', () => {
  expect(renderToStaticMarkup(<KvCardView name="k" type="none" value={null} ttl={-2} />)).toContain(
    'does not exist',
  );
  expect(renderToStaticMarkup(<TtlTimerView name="k" ttl={-2} readAt={0} />)).toContain('gone');
  expect(renderToStaticMarkup(<TtlTimerView name="k" ttl={-1} readAt={0} />)).toContain(
    'never expires',
  );
  expect(renderToStaticMarkup(<GeoMapView name="k" points={[]} />)).toContain('No coordinates');
  expect(
    renderToStaticMarkup(<GeoMapView name="k" points={[{ member: 'a', lon: 1, lat: 1 }]} />),
  ).toContain('circle');
  expect(renderToStaticMarkup(<CacheStatsView hits={0} misses={0} keys={0} />)).toContain(
    'no reads yet',
  );
});

test('helpers', () => {
  expect(currentStreak([0, 1, 1, 0, 1, 1, 1])).toBe(3);
  expect(currentStreak([1, 0])).toBe(0);
  expect(fmtDuration(86399)).toBe('23h 59m 59s');
  expect(bitfieldArgs('k', 2)).toEqual(['BITFIELD', 'k', 'GET', 'u1', '#0', 'GET', 'u1', '#1']);
  expect(infoField('keyspace_hits:12\r\nkeyspace_misses:3\r\n', 'keyspace_hits')).toBe(12);
  expect(infoField('', 'keyspace_hits')).toBe(0);
  expect(renderKey('game:player:{{player.id}}', 'p-1')).toBe('game:player:p-1');
  expect(renderKey('login:{{ player.id }}:2026-11', 'p-1')).toBe('login:p-1:2026-11');
  expect(renderKey('lb:hostel:h-c-02-1', 'p-1')).toBe('lb:hostel:h-c-02-1');
});

test('stats_latency_panel shows the numbers, the caption and the missing keys', () => {
  const html = renderToStaticMarkup(<StatsLatencyView {...s.stats} />);
  expect(html).toContain('640 ms');
  expect(html).toContain('182 ms');
  expect(html).toContain('the page is slow because every request asks Postgres');
  expect(html).toContain('cache:player:p-028');
  expect(html).toContain('does not exist yet');
  const empty = renderToStaticMarkup(
    <StatsLatencyView
      route={STATS_ROUTE}
      p50={null}
      p99={null}
      rps={null}
      dbQps={null}
      p99Series={[]}
      keys={[]}
    />,
  );
  expect(empty).toContain('no data');
  expect(empty).toContain('not reported');
  expect(empty).not.toContain('stats-keys');
});

test('routeTickSeries keeps only the seconds where the route had traffic', () => {
  const tick = (routes: Record<string, Record<string, number>>) => ({
    at: 'x',
    count: 0,
    errors: 0,
    p50Ms: 0,
    p99Ms: 0,
    routes,
  });
  const r = routeTickSeries(
    [
      tick({ [STATS_ROUTE]: { count: 5, p50Ms: 100, p99Ms: 300, dbQueries: 5 } }),
      tick({ 'GET /other': { count: 1, p50Ms: 1, p99Ms: 1 } }),
      tick({ [STATS_ROUTE]: { count: 7, p50Ms: 110, p99Ms: 320 } }),
    ],
    STATS_ROUTE,
  );
  expect(r.rps).toEqual([5, 7]);
  expect(r.p99).toEqual([300, 320]);
  expect(r.db).toEqual([5]);
});

test('otp_limiter_panel renders each limiter shape and the empty state', () => {
  const base = { ...s.limiter, fields: [] as [string, string][], value: null, members: null };
  const bucket = renderToStaticMarkup(<OtpLimiterView {...s.limiter} />);
  expect(bucket).toContain('token bucket');
  expect(bucket).toContain('tokens');
  expect(bucket).toContain('126');
  const win = renderToStaticMarkup(
    <OtpLimiterView {...base} type="string" value="4" ttl={42} pingRequests={null} />,
  );
  expect(win).toContain('fixed window');
  expect(win).toContain('in 42s');
  expect(win).toContain('no traffic yet');
  const log = renderToStaticMarkup(<OtpLimiterView {...base} type="zset" members={9} />);
  expect(log).toContain('sorted-set log');
  expect(log).toContain('>9<');
  expect(renderToStaticMarkup(<OtpLimiterView {...base} type="none" />)).toContain(
    'does not exist',
  );
});
