// E-03: the Redis target switcher in the terminal header. The UI has no DOM test environment, so the view renders
// to static markup and the click is the same function the select calls (`switchTarget`), run against a fake route.
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, test } from 'vitest';
import { ApiError } from '../src/api';
import {
  CUSTOM_ID,
  FOLLOW_COPY,
  TARGET_PRESETS,
  TargetSwitchView,
  presetIdFor,
  promptFor,
  switchTarget,
} from '../src/panels/TargetSwitch';
import type { TargetInfo } from '../src/types';

const single: TargetInfo = {
  redisUrl: 'redis://redis:6379',
  kind: 'single',
  description: 'single node redis:6379',
  state: 'up',
};
const sentinel: TargetInfo = {
  redisUrl: 'sentinel://mymaster@sentinel-1:26379,sentinel-2:26379,sentinel-3:26379',
  kind: 'sentinel',
  description: 'sentinel mymaster via 3 sentinels',
  state: 'up',
  master: 'redis-replica:6379',
  nodes: 3,
};

test('the presets are the five targets of the spec, each a string the engine accepts', () => {
  expect(TARGET_PRESETS.map((p) => p.url)).toEqual([
    'redis://redis:6379',
    'redis://redis-nopersist:6379',
    'redis://redis-replica:6379',
    'sentinel://mymaster@sentinel-1:26379,sentinel-2:26379,sentinel-3:26379',
    'cluster://redis-c1:6379,redis-c2:6379,redis-c3:6379',
  ]);
  expect(TARGET_PRESETS[0]?.label).toBe('Single node (redis:6379)');
  expect(TARGET_PRESETS[2]?.label).toBe('Replica, read-only (redis-replica)');
});

test('renders the select, the up dot, the description and the follow line', () => {
  const html = renderToStaticMarkup(<TargetSwitchView info={single} selected="single" />);
  expect(html).toContain('data-testid="target-select"');
  for (const p of TARGET_PRESETS) expect(html).toContain(p.label);
  expect(html).toContain('Custom…');
  expect(html).toContain('data-state="up"');
  expect(html).toContain('single node redis:6379');
  expect(html).toContain(FOLLOW_COPY);
  expect(FOLLOW_COPY).toBe('The app and the runner follow within about two seconds.');
  expect(html).not.toContain('data-testid="target-custom"');
});

test('renders down, the sentinel master, and the custom input', () => {
  expect(
    renderToStaticMarkup(
      <TargetSwitchView info={{ ...single, state: 'down' }} selected="single" />,
    ),
  ).toContain('data-state="down"');
  const html = renderToStaticMarkup(<TargetSwitchView info={sentinel} selected="sentinel" />);
  expect(html).toContain('sentinel mymaster via 3 sentinels, master redis-replica:6379');
  const custom = renderToStaticMarkup(
    <TargetSwitchView info={single} selected={CUSTOM_ID} customText="cluster://a:6379" />,
  );
  expect(custom).toContain('data-testid="target-custom"');
  expect(custom).toContain('value="cluster://a:6379"');
});

test('presetIdFor maps a URL to its preset, anything else is custom', () => {
  expect(presetIdFor('redis://redis-replica:6379')).toBe('replica');
  expect(presetIdFor(TARGET_PRESETS[4]?.url)).toBe('cluster');
  expect(presetIdFor('redis://elsewhere:6379')).toBe(CUSTOM_ID);
  expect(presetIdFor(undefined)).toBe(CUSTOM_ID);
});

test('choosing a target calls PUT /api/target with that string and returns the engine answer', async () => {
  const calls: string[] = [];
  const r = await switchTarget('  cluster://redis-c1:6379  ', async (u) => {
    calls.push(u);
    return { ...single, redisUrl: u, kind: 'cluster', description: 'cluster, 1 root node' };
  });
  expect(calls).toEqual(['cluster://redis-c1:6379']);
  expect(r.ok).toBe(true);
  if (r.ok) expect(r.info.kind).toBe('cluster');
});

test('a connect failure shows the engine message and the selection stays', async () => {
  const msg = 'Could not connect to cluster, 3 root nodes: no slots';
  const r = await switchTarget('cluster://nowhere:6379', async () => {
    throw new ApiError(502, 'target_unreachable', msg);
  });
  expect(r).toEqual({ ok: false, message: msg });
  // The view keeps the old selection (it is derived from the engine's answer) and shows the message.
  const html = renderToStaticMarkup(
    <TargetSwitchView info={single} selected="single" message={r.ok ? null : r.message} />,
  );
  expect(html).toContain('data-testid="target-message"');
  expect(html).toContain(msg);
  expect(html).toContain('data-state="up"');
});

test('an empty custom string is refused without calling the engine', async () => {
  let called = false;
  const r = await switchTarget('   ', async () => {
    called = true;
    return single;
  });
  expect(called).toBe(false);
  expect(r.ok).toBe(false);
});

test('the prompt says where the terminal is', () => {
  expect(promptFor(null)).toBe('redis> ');
  expect(promptFor(single)).toBe('redis:6379> ');
  expect(promptFor(sentinel)).toBe('mymaster@redis-replica:6379> ');
  expect(promptFor({ ...single, kind: 'cluster', redisUrl: 'cluster://redis-c1:6379' })).toBe(
    'cluster> ',
  );
});
