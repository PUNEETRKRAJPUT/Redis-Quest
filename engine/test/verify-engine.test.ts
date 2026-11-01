// Verdict wiring: the example levels graded end to end with a fake Redis and a fake runner.
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import pino from 'pino';
import { beforeAll, describe, expect, test } from 'vitest';
import { loadChapter, type LoadedLevel } from '@quest/shared';
import { EventBus } from '../src/events.js';
import type { RunFn } from '../src/verify/behavior.js';
import { loadCaps } from '../src/verify/config.js';
import { levelSlots, Verifier, VerifyBusyError } from '../src/verify/index.js';
import { formatCommand } from '../src/verify/reply.js';

const LEVELS = join(dirname(fileURLToPath(import.meta.url)), '../../levels');
const levels = new Map<string, LoadedLevel>();

beforeAll(async () => {
  for (const d of ['_examples/example-cli', '_examples/example-code', '_examples/example-decision', 'ch0-boot']) {
    const r = await loadChapter(join(LEVELS, d));
    expect(r.errors).toEqual([]);
    for (const l of r.chapter?.levels ?? []) levels.set(l.level.id, l);
  }
});

function make(replies: Record<string, unknown>, run?: RunFn) {
  const bus = new EventBus();
  const sent: string[] = [];
  const redis = {
    url: 'redis://fake:6379',
    isUp: true,
    send: async (argv: string[]) => {
      const k = formatCommand(argv);
      sent.push(k);
      if (k in replies) return replies[k];
      if (argv[0] === 'DEL') return 1;
      throw new Error(`fake redis has no reply for ${k}`);
    },
    client: () => {
      throw new Error('no client');
    },
    onUp: () => undefined,
  };
  const v = new Verifier({
    cfg: { runnerUrl: '', appUrl: 'http://proxy:3000/app', scenariosDir: '', baselinesDir: '/nonexistent', engineApi: 'http://127.0.0.1:1/api', caps: loadCaps({}), maxEventWaitMs: 50 },
    log: pino({ level: 'silent' }),
    bus,
    redis: redis as never,
    run: run ?? (async () => ({ results: [] })),
  });
  return { v, bus, sent };
}

const tctx = (levelId: string, chapterId: string) => ({ player: { id: 'p-1', name: 'Asha' }, level: { id: levelId }, chapter: { id: chapterId }, env: {} });

describe('example-cli: redis + answer + antipattern', () => {
  const id = 'example-cli-01-hostel-scoreboard';
  const right = {
    'TYPE lb:hostel:h-c-02-2': 'zset',
    'ZCARD lb:hostel:h-c-02-2': 5,
    'ZSCORE lb:hostel:h-c-02-2 user:p-1': '150',
    'ZREVRANK lb:hostel:h-c-02-2 user:p-1': 0,
    'EXISTS lb:hostel:h-c-02-2:list': 0,
  };
  const go = (replies: Record<string, unknown>, answer = '0') =>
    make(replies).v.verify(levels.get(id)!, { templateCtx: tctx(id, 'example-cli'), attempt: 1, answers: { '1': answer } });

  test('reference state is right', async () => {
    const o = await go(right);
    expect(o.verdict).toBe('right');
    expect(o.checks.map((c) => [c.index, c.type, c.ok])).toEqual([[0, 'redis', true], [1, 'answer', true], [2, 'antipattern', true]]);
    expect(o.checks[2]?.message).toBe('No antipattern found.');
  });
  test('ZADD twice is wrong, with the level message and the observed value', async () => {
    const o = await go({ ...right, 'ZSCORE lb:hostel:h-c-02-2 user:p-1': '30', 'ZREVRANK lb:hostel:h-c-02-2 user:p-1': 4 }, '4');
    expect(o.verdict).toBe('wrong');
    expect(o.checks[0]?.message).toBe(
      'Your score should be 150 (120, then 30 more). If it is 30, the second ZADD replaced it instead of adding. (expected 150, got 30)\nWith 150 points you should be at the top (rank 0). (expected 0, got 4)',
    );
  });
  test('list copy is works_but_wrong', async () => {
    const o = await go({ ...right, 'EXISTS lb:hostel:h-c-02-2:list': 1 });
    expect(o.verdict).toBe('works_but_wrong');
    expect(o.checks[2]?.message).toMatch(/^This passes today, but you also keep a list copy .* \(expected 0, got 1\)$/);
  });
  test('a wrong typed answer alone makes it wrong', async () => {
    expect((await go(right, '3')).verdict).toBe('wrong');
  });
});

describe('example-decision: quizzes', () => {
  const id = 'example-decision-01-pick-the-structure';
  const go = (answers: Record<string, string>) => make({}).v.verify(levels.get(id)!, { templateCtx: tctx(id, 'example-decision'), attempt: 1, answers });
  test('reference right, each wrong option wrong', async () => {
    const ref = { '0': 'lb-sorted-set', '1': 'profile-hash', '2': 'streak-bitmap' };
    expect((await go(ref)).verdict).toBe('right');
    expect((await go({ ...ref, '0': 'lb-list' })).verdict).toBe('wrong');
    expect((await go({ ...ref, '1': 'profile-json' })).verdict).toBe('wrong');
    expect((await go({ ...ref, '2': 'streak-sorted-set' })).verdict).toBe('wrong');
    expect((await go({})).verdict).toBe('wrong');
  });
});

describe('example-code token bucket: behavior + behavior-shaped antipattern', () => {
  const id = 'example-code-02-token-bucket';
  const runner = (seq: boolean[], conc: boolean[]): RunFn => async (req) => ({
    results: req.calls.map((_, i) => ({ ok: true, value: (req.concurrency > 1 ? conc : seq)[i] ?? false, ms: 1 })),
  });
  const tenOf = (n: number) => Array.from({ length: n }, (_, i) => i < 10);
  const go = (run: RunFn) => make({ 'TYPE ratelimit:u-limit-1': 'hash' }, run).v.verify(levels.get(id)!, { templateCtx: tctx(id, 'example-code'), attempt: 1, answers: {} });

  test('atomic bucket is right', async () => expect((await go(runner(tenOf(15), tenOf(100)))).verdict).toBe('right'));
  test('allow-all is wrong', async () => {
    const o = await go(runner(Array(15).fill(true), Array(100).fill(true)));
    expect(o.verdict).toBe('wrong');
    expect(o.checks[0]?.message).toBe('Sent 15 requests one after another; exactly 10 should be allowed. (expected exactly 10 of 15 calls to return true, got 15)');
  });
  test('racy JS bucket is works_but_wrong', async () => {
    const o = await go(runner(tenOf(15), Array.from({ length: 100 }, (_, i) => i < 37)));
    expect(o.verdict).toBe('works_but_wrong');
    expect(o.checks[1]?.message).toMatch(/^This passes one request at a time, .* \(expected at most 10 of 100 calls to return true, got 37\)$/);
  });
  test('fixtures run before each behavior verifier', async () => {
    const { v, sent } = make({ 'TYPE ratelimit:u-limit-1': 'hash' }, runner(tenOf(15), tenOf(100)));
    await v.verify(levels.get(id)!, { templateCtx: tctx(id, 'example-code'), attempt: 1, answers: {} });
    expect(sent.filter((s) => s === 'DEL ratelimit:u-limit-1 ratelimit:u-limit-2')).toHaveLength(2);
  });
  test('levelSlots', () => expect(levelSlots(levels.get(id)!.level.verify)).toEqual(['ratelimit.allow']));
});

describe('example-code cache-aside: traffic is skipped once the verdict is already wrong', () => {
  test('behavior fails, traffic skipped, verdict wrong', async () => {
    const id = 'example-code-01-cache-aside';
    const run: RunFn = async () => ({ results: [{ ok: true, value: { player_id: 'p-028' }, ms: 200 }] });
    const { v } = make({ 'TYPE cache:player:p-028': 'none', 'TTL cache:player:p-028': -2 }, run);
    const o = await v.verify(levels.get(id)!, { templateCtx: tctx(id, 'example-code'), attempt: 1, answers: {} });
    expect(o.verdict).toBe('wrong');
    expect(o.checks[1]).toMatchObject({ type: 'traffic', ok: false, skipped: true, message: 'Skipped: another check already failed, so the load test was not run (your code is only put into the app once it passes in the runner).' });
  });
});

describe('Chapter 0 events', () => {
  test('ch0-01: ui_connected since start plus a boot is right; no ui_connected is wrong', async () => {
    const id = 'ch0-01-bhai-it-works-on-my-laptop';
    const startedAt = new Date(Date.now() - 1000).toISOString();
    const a = make({ 'GET game:engine:boots': '1' });
    a.bus.emit('level.event', { kind: 'custom', name: 'ui_connected' });
    expect((await a.v.verify(levels.get(id)!, { templateCtx: tctx(id, 'ch0'), startedAt, attempt: 1, answers: {} })).verdict).toBe('right');
    const b = make({ 'GET game:engine:boots': '1' });
    const o = await b.v.verify(levels.get(id)!, { templateCtx: tctx(id, 'ch0'), startedAt, attempt: 1, answers: {} });
    expect(o.verdict).toBe('wrong');
    expect(o.checks[0]?.message).toBe(
      'The game page has not reached the engine yet. Is the stack up, and did you reload this page after it started? (nothing since the level started, and nothing in 0.1 s of waiting)',
    );
  });
  test('progress events are emitted for every check, and do not pollute event grading', async () => {
    const id = 'ch0-02-say-hello';
    const { v, bus } = make({});
    const names: string[] = [];
    bus.subscribe((e) => e.type === 'level.event' && names.push(String((e.data as { name?: string }).name)));
    await v.verify(levels.get(id)!, { templateCtx: tctx(id, 'ch0'), attempt: 1, answers: {} });
    expect(names).toEqual(['verify_started', 'verify_check_started', 'verify_check_finished', 'verify_finished']);
  });
});

describe('409', () => {
  test('one verification per player at a time', () => {
    const { v } = make({});
    const done = v.begin('p-1');
    expect(() => v.begin('p-1')).toThrow(VerifyBusyError);
    done();
    expect(() => v.begin('p-1')).not.toThrow();
  });
});

describe('traffic runs after every other verifier, results stay in list order', () => {
  test('progress order: behavior, antipattern, then traffic', async () => {
    const id = 'example-code-01-cache-aside';
    const run: RunFn = async () => ({ results: [{ ok: true, value: {}, ms: 1 }] });
    const { v, bus } = make({ 'TYPE cache:player:p-028': 'none', 'TTL cache:player:p-028': -2 }, run);
    const started: number[] = [];
    bus.subscribe((e) => {
      const d = e.data as { name?: string; data?: { index: number } };
      if (d.name === 'verify_check_started') started.push(d.data!.index);
    });
    const o = await v.verify(levels.get(id)!, { templateCtx: tctx(id, 'example-code'), attempt: 1, answers: {} });
    expect(started).toEqual([0, 2, 1]);
    expect(o.checks.map((c) => c.index)).toEqual([0, 1, 2]);
  });
});
