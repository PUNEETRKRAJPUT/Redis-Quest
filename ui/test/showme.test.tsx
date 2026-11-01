import { renderToStaticMarkup } from 'react-dom/server';
import { expect, test } from 'vitest';
import { bitfieldArgs, infoField, isShowMeId, renderKey, SHOW_ME_IDS } from '../src/showme';
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
  SetChipsView,
  StreamLogView,
  TtlTimerView,
} from '../src/showme/views';

const s = SAMPLE;

test('twelve ids, matching the spec', () => {
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
