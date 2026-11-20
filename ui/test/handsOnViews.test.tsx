import { renderToStaticMarkup } from 'react-dom/server';
import type { ReactNode } from 'react';
import { expect, test } from 'vitest';
import { FrameContext, RanBar } from '../src/showme/frame';
import type { FrameState, HandsOn } from '../src/showme/frame';
import { HANDS_ON_IDS, SHOW_ME_IDS } from '../src/showme';
import { SAMPLE } from '../src/showme/sample';
import {
  AclUsersView,
  BfCardView,
  BitmapStreakView,
  CacheStatsView,
  FtCardView,
  GeoMapView,
  HllCounterView,
  JsonTreeView,
  StreamGroupsView,
  StreamLogView,
  TsChartView,
  HashCardView,
  KvCardView,
  LeaderboardPanelView,
  ListFeedView,
  SetChipsView,
  TtlTimerView,
} from '../src/showme/views';

const s = SAMPLE;
const hands: HandsOn = {
  run: async () => true,
  busy: false,
  last: {
    command: 'SET practice:string "a b"',
    ok: true,
    reply: 'OK',
    note: 'Saved.',
    error: null,
    ms: 0.4,
    at: 1,
  },
};
const ctx = (over: Partial<FrameState>): FrameState => ({
  interactive: true,
  hands,
  locked: false,
  sample: false,
  ...over,
});
const within = (c: Partial<FrameState>, node: ReactNode) =>
  renderToStaticMarkup(<FrameContext.Provider value={ctx(c)}>{node}</FrameContext.Provider>);

test('thirteen panels are hands-on; the spec names them', () => {
  expect([...HANDS_ON_IDS]).toEqual([
    'kv_card',
    'hash_card',
    'list_feed',
    'set_chips',
    'leaderboard_panel',
    'ttl_timer',
    'stream_log',
    'json_tree',
    'bitmap_streak',
    'hll_counter',
    'geo_map',
    'bf_card',
    'ts_chart',
  ]);
  for (const id of HANDS_ON_IDS) expect(SHOW_ME_IDS).toContain(id);
});

test('without the interactive flag no panel shows a control or a command line', () => {
  const plain = renderToStaticMarkup(
    <>
      <KvCardView {...s.kv} />
      <ListFeedView {...s.list} />
      <LeaderboardPanelView {...s.board} />
      <TtlTimerView {...s.ttl} readAt={0} />
    </>,
  );
  expect(plain).not.toContain('<input');
  expect(plain).not.toContain('ran-bar');
  expect(plain).not.toContain('showme-readonly');
});

test('hands-on mode renders each gesture with the command it will send', () => {
  expect(within({}, <KvCardView {...s.kv} />)).toContain('>SET<');
  const hash = within({}, <HashCardView {...s.hash} />);
  expect(hash).toContain('>HSET<');
  expect(hash).toContain('Click to edit');
  const list = within({}, <ListFeedView {...s.list} />);
  for (const c of ['LPUSH', 'RPUSH', 'LPOP', 'RPOP']) expect(list).toContain(`>${c}<`);
  const set = within({}, <SetChipsView {...s.set} />);
  expect(set).toContain('>SADD<');
  expect(set).toContain('Remove p-028 (SREM)');
  const board = within({}, <LeaderboardPanelView {...s.board} />);
  expect(board).toContain('Plus 1 for user:teja');
  expect(board).toContain('Minus 1 for user:teja');
  expect(board).toContain('>ZINCRBY<');
  const ttl = within({}, <TtlTimerView {...s.ttl} readAt={Date.now()} />);
  expect(ttl).toContain('>EXPIRE<');
  expect(ttl).toContain('>PERSIST<');
  expect(ttl).toContain('Seconds until the key expires');
});

test('the ran line shows the exact command, copyable, plus the plain-words note', () => {
  const html = within({}, <KvCardView {...s.kv} />);
  expect(html).toContain('data-testid="ran-command"');
  expect(html).toContain('SET practice:string &quot;a b&quot;');
  expect(html).toContain('Saved.');
  expect(html).toContain('Copy the command');
  const err = renderToStaticMarkup(
    <RanBar
      last={{
        command: 'LPOP practice:s',
        ok: false,
        reply: '',
        note: null,
        error: 'That key holds a different kind of value, so this command does not fit it.',
        ms: null,
        at: 2,
      }}
    />,
  );
  expect(err).toContain('role="alert"');
  expect(err).toContain('different kind of value');
});

test('an engine key is read but never offered a control; the panel says why', () => {
  const html = within(
    { locked: true, hands: null },
    <HashCardView name="game:player:p-1" fields={[['xp', '45']]} />,
  );
  expect(html).toContain('showme-locked');
  expect(html).not.toContain('>HSET<');
  expect(html).not.toContain('ran-bar');
  expect(html).toContain('45');
});

test('read-only panels say so in hands-on mode, and sample panels have inert controls', () => {
  expect(within({ hands: null }, <CacheStatsView {...s.cache} />)).toContain('showme-readonly');
  const sample = within({ hands: null, sample: true }, <KvCardView {...s.kv} />);
  expect(sample).toContain('data-feed="sample"');
  expect(sample).toContain('disabled');
});

test('every panel carries the same frame: key in mono, type pill, light', () => {
  const html = within({ interactive: false, hands: null }, <KvCardView {...s.kv} />);
  expect(html).toContain('showme-key');
  expect(html).toContain('data-feed="live"');
  expect(html).toContain('>live<');
});

test('the seven new panels render each gesture with the command it sends', () => {
  const stream = within({}, <StreamLogView {...s.stream} />);
  expect(stream).toContain('>XADD<');
  expect(stream).toContain('Second field (optional)');
  const json = within({}, <JsonTreeView {...s.json} />);
  expect(json).toContain('>JSON.SET<');
  expect(json).toContain('>JSON.NUMINCRBY<');
  const streak = within({}, <BitmapStreakView {...s.streak} />);
  expect(streak).toContain('>SETBIT<');
  expect(streak).toContain('SETBIT 1');
  expect(within({}, <HllCounterView {...s.hll} />)).toContain('>PFADD<');
  const geo = within({}, <GeoMapView {...s.geo} />);
  expect(geo).toContain('>GEOADD<');
  expect(geo).toContain('longitude, then');
  const bf = within({}, <BfCardView {...s.bf} />);
  expect(bf).toContain('>BF.ADD<');
  expect(bf).toContain('>BF.EXISTS<');
  expect(within({}, <TsChartView {...s.ts} />)).toContain('>TS.ADD<');
});

test('the new panels offer no control without hands-on mode or on an engine key', () => {
  const plain = renderToStaticMarkup(
    <>
      <StreamLogView {...s.stream} />
      <JsonTreeView {...s.json} />
      <BitmapStreakView {...s.streak} />
      <HllCounterView {...s.hll} />
      <GeoMapView {...s.geo} />
      <BfCardView {...s.bf} />
      <TsChartView {...s.ts} />
    </>,
  );
  expect(plain).not.toContain('<input');
  expect(plain).not.toContain('<button');
  expect(plain).not.toContain('ran-bar');
  const locked = within({ locked: true, hands: null }, <HllCounterView name="game:h" count={3} />);
  expect(locked).toContain('showme-locked');
  expect(locked).not.toContain('>PFADD<');
});

test('each of the six read-only panels says why in one line', () => {
  const html = [
    within({ hands: null }, <CacheStatsView {...s.cache} />),
    within({ hands: null }, <StreamGroupsView {...s.groups} />),
    within({ hands: null }, <FtCardView {...s.ft} />),
    within({ hands: null }, <AclUsersView {...s.acl} />),
  ];
  for (const h of html) {
    expect(h).toContain('showme-readonly');
    expect(h).toContain('This panel only reads:');
  }
});
