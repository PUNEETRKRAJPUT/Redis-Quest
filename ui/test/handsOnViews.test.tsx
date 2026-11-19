import { renderToStaticMarkup } from 'react-dom/server';
import type { ReactNode } from 'react';
import { expect, test } from 'vitest';
import { FrameContext, RanBar } from '../src/showme/frame';
import type { FrameState, HandsOn } from '../src/showme/frame';
import { HANDS_ON_IDS, SHOW_ME_IDS } from '../src/showme';
import { SAMPLE } from '../src/showme/sample';
import {
  CacheStatsView,
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

test('six panels are hands-on; the spec names them', () => {
  expect([...HANDS_ON_IDS]).toEqual([
    'kv_card',
    'hash_card',
    'list_feed',
    'set_chips',
    'leaderboard_panel',
    'ttl_timer',
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
