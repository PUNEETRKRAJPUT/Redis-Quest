// F-12: the interview timer and hint cost. The rules are pure functions of an explicit clock (no sleeping);
// the routes are exercised through Fastify's inject with a stubbed Redis, so start, GET, hint and the dev
// complete shortcut are the real handlers on a real progress.json.
import { cp, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import pino from 'pino';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { loadChapter } from '@quest/shared';
import type { Config } from '../src/config.js';
import { EventBus } from '../src/events.js';
import {
  chargeHint,
  elapsedMs,
  interviewSpec,
  interviewView,
  isOvertime,
  remainingMs,
  settlePass,
  startInterview,
  verifyTiming,
  type InterviewSpec,
} from '../src/interview.js';
import { LevelService } from '../src/levels.js';
import { MetricsStore } from '../src/metrics.js';
import {
  newProgress,
  ProgressStore,
  reconcileLevels,
  type LevelProgress,
  type ProgressFile,
} from '../src/progress.js';
import { buildServer } from '../src/server.js';

const EXAMPLES = join(dirname(fileURLToPath(import.meta.url)), '../../levels/_examples');
const T0 = Date.parse('2026-11-01T10:00:00.000Z');
const MIN = 60_000;
const spec: InterviewSpec = {
  minutes: 10,
  rebuildOf: 'example-code-01-cache-aside',
  hintXpCost: 10,
};
const fresh = (): LevelProgress => ({ status: 'in_progress', attempts: 0, verdicts: [] });
const started = (): LevelProgress => {
  const lp = fresh();
  startInterview(lp, new Date(T0).toISOString());
  return lp;
};

describe('timer', () => {
  test('nothing is running before the level is started', () => {
    const lp = fresh();
    expect(remainingMs(spec, lp, T0)).toBeNull();
    expect(elapsedMs(lp, T0)).toBeNull();
    expect(isOvertime(spec, lp, T0 + 99 * MIN)).toBe(false);
  });

  test('the first start wins, a second start does not refill the clock', () => {
    const lp = started();
    startInterview(lp, new Date(T0 + 5 * MIN).toISOString());
    expect(lp.interviewStartedAt).toBe(new Date(T0).toISOString());
  });

  test('remaining counts down and stops at zero', () => {
    const lp = started();
    expect(remainingMs(spec, lp, T0)).toBe(10 * MIN);
    expect(remainingMs(spec, lp, T0 + 4 * MIN + 30_000)).toBe(5 * MIN + 30_000);
    expect(remainingMs(spec, lp, T0 + 10 * MIN)).toBe(0);
    expect(remainingMs(spec, lp, T0 + 25 * MIN)).toBe(0);
  });

  test('overtime starts after the deadline, not at it', () => {
    const lp = started();
    expect(isOvertime(spec, lp, T0 + 10 * MIN)).toBe(false);
    expect(isOvertime(spec, lp, T0 + 10 * MIN + 1)).toBe(true);
    expect(verifyTiming(spec, lp, T0 + 9 * MIN)).toEqual({ overtime: false, elapsedMs: 9 * MIN });
    expect(verifyTiming(spec, lp, T0 + 11 * MIN)).toEqual({ overtime: true, elapsedMs: 11 * MIN });
  });

  test('a clock that runs backwards never gives negative time', () => {
    expect(elapsedMs(started(), T0 - 5000)).toBe(0);
  });

  test('a pass freezes the time and whether it was late', () => {
    const inTime = started();
    settlePass(spec, inTime, T0 + 7 * MIN + 12_000);
    expect(inTime).toMatchObject({ interviewElapsedMs: 7 * MIN + 12_000, overtime: false });
    const late = started();
    settlePass(spec, late, T0 + 12 * MIN);
    expect(late).toMatchObject({ interviewElapsedMs: 12 * MIN, overtime: true });
    const never = fresh();
    settlePass(spec, never, T0);
    expect(never.interviewElapsedMs).toBeUndefined();
  });

  test('the view: live while in progress, frozen after a pass', () => {
    const lp = started();
    lp.hintsBought = 2;
    const live = interviewView(spec, lp, T0 + 3 * MIN, 'Cache-aside');
    expect(live.remainingMs).toBe(7 * MIN);
    expect(live.interview).toMatchObject({
      minutes: 10,
      hintXpCost: 10,
      hintsBought: 2,
      overtime: false,
      overtimeMs: 0,
      elapsedMs: null,
      startedAt: new Date(T0).toISOString(),
      deadlineAt: new Date(T0 + 10 * MIN).toISOString(),
      rebuildOf: { id: 'example-code-01-cache-aside', title: 'Cache-aside' },
    });
    lp.status = 'passed';
    settlePass(spec, lp, T0 + 4 * MIN);
    const frozen = interviewView(spec, lp, T0 + 90 * MIN, null);
    expect(frozen.remainingMs).toBe(6 * MIN);
    expect(frozen.interview).toMatchObject({ overtime: false, overtimeMs: 0, elapsedMs: 4 * MIN });
    expect(interviewView(spec, started(), T0 + 10 * MIN + 31_000, null).interview).toMatchObject({
      overtime: true,
      overtimeMs: 31_000,
    });
  });

  test('the view before the clock starts has no deadline', () => {
    const v = interviewView(spec, fresh(), T0, null);
    expect(v.remainingMs).toBeNull();
    expect(v.interview).toMatchObject({ startedAt: null, deadlineAt: null, overtime: false });
  });
});

describe('hint cost', () => {
  const player = () => {
    const p = newProgress({
      id: 'p-1',
      name: 'A',
      redisUrl: 'redis://x',
      activeSlots: [],
      now: new Date(),
    });
    p.xp = 35;
    return p;
  };

  test('each hint takes hint_xp_cost and is counted', () => {
    const p = player();
    const lp = fresh();
    expect(chargeHint(spec, p, lp)).toEqual({ charged: 10, xp: 25, hintsBought: 1 });
    expect(chargeHint(spec, p, lp)).toEqual({ charged: 10, xp: 15, hintsBought: 2 });
    expect(lp.hintsBought).toBe(2);
  });

  test('XP never goes below zero and `charged` says what was really taken', () => {
    const p = player();
    p.xp = 4;
    const lp = fresh();
    expect(chargeHint(spec, p, lp)).toEqual({ charged: 4, xp: 0, hintsBought: 1 });
    expect(chargeHint(spec, p, lp)).toEqual({ charged: 0, xp: 0, hintsBought: 2 });
  });

  test('a free hint (cost 0) still counts as bought', () => {
    const p = player();
    const lp = fresh();
    expect(chargeHint({ ...spec, hintXpCost: 0 }, p, lp)).toEqual({
      charged: 0,
      xp: 35,
      hintsBought: 1,
    });
  });
});

describe('routes', () => {
  let root: string;
  let store: ProgressStore;
  let levels: LevelService;
  let app: Awaited<ReturnType<typeof buildServer>>;
  const GUIDED = 'example-code-01-cache-aside';
  const DEADLINE_AFTER_GUIDED = 'example-code-02-token-bucket';
  const IV = 'example-interview-01-cache-aside-rebuild';

  const get = async (url: string) => app.inject({ method: 'GET', url });
  const post = async (url: string, payload: unknown = {}) =>
    app.inject({ method: 'POST', url, payload: payload as object });
  const ageClock = (minutes: number) =>
    store.update((d) => {
      const l = d.levels[IV] as LevelProgress;
      l.interviewStartedAt = new Date(Date.now() - minutes * MIN).toISOString();
    });

  beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), 'quest-f12-'));
    await cp(join(EXAMPLES, 'example-code'), join(root, 'levels', 'example-code'), {
      recursive: true,
    });
    await cp(join(EXAMPLES, 'example-interview'), join(root, 'levels', 'example-interview'), {
      recursive: true,
    });
    const cfg: Config = {
      port: 0,
      redisUrl: 'redis://fake',
      databaseUrl: 'postgres://nobody@127.0.0.1:1/x',
      logDir: join(root, 'logs'),
      progressDir: join(root, 'progress'),
      workspaceDir: join(root, 'workspace'),
      levelsDir: join(root, 'levels'),
      uiDistDir: join(root, 'ui'),
      dev: true,
      templateEnv: {},
    };
    levels = new LevelService(cfg.levelsDir);
    await levels.load();
    expect(levels.errors).toEqual([]);
    store = new ProgressStore(cfg.progressDir);
    const p: ProgressFile = newProgress({
      id: 'p-1',
      name: 'Asha',
      redisUrl: 'redis://fake',
      activeSlots: [],
      now: new Date(),
    });
    reconcileLevels(p, levels.orderedIds);
    await store.create(p);
    const redis = {
      url: 'redis://fake',
      isUp: true,
      send: async () => 'OK',
      onUp: () => undefined,
    };
    app = await buildServer({
      cfg,
      log: pino({ level: 'silent' }),
      bus: new EventBus(),
      store,
      redis: redis as never,
      mirror: { write: async () => undefined, setGift: async () => undefined } as never,
      levels,
      logtail: { attach: () => undefined, tail: async () => [] } as never,
      metrics: new MetricsStore(),
      runtime: { redisUrl: 'redis://fake', activeSlots: [], dbExtraLatencyMs: 0, boots: 1 },
    });
    // Pass the guided levels so the interview is unlocked and the player has XP to spend.
    for (const id of [GUIDED, DEADLINE_AFTER_GUIDED]) {
      expect((await post(`/api/levels/${id}/start`)).statusCode).toBe(200);
      expect((await post(`/api/levels/${id}/complete`)).statusCode).toBe(200);
    }
  });
  afterAll(async () => {
    await app.close();
    await rm(root, { recursive: true, force: true });
  });

  test('the interview level is loaded and the guided level is not an interview', async () => {
    expect(interviewSpec(levels.get(IV)!.level)).toEqual({
      minutes: 10,
      rebuildOf: GUIDED,
      hintXpCost: 10,
    });
    expect(interviewSpec(levels.get(GUIDED)!.level)).toBeNull();
    const r = (await loadChapter(join(root, 'levels', 'example-interview'))).chapter!;
    expect(r.levels).toHaveLength(1);
  });

  test('a guided level has interview: null and remainingMs: null', async () => {
    const body = (await get(`/api/levels/${GUIDED}`)).json();
    expect(body.interview).toBeNull();
    expect(body.remainingMs).toBeNull();
    expect(body.teach).toContain('Cache-aside');
  });

  test('before start the level has no clock; start records interviewStartedAt', async () => {
    const before = (await get(`/api/levels/${IV}`)).json();
    expect(before.interview).toMatchObject({ minutes: 10, hintXpCost: 10, startedAt: null });
    expect(before.remainingMs).toBeNull();
    const r = await post(`/api/levels/${IV}/start`);
    expect(r.statusCode).toBe(200);
    const after = (await get(`/api/levels/${IV}`)).json();
    expect(after.interview.startedAt).toEqual(expect.any(String));
    expect(after.remainingMs).toBeGreaterThan(10 * MIN - 5000);
    expect(after.remainingMs).toBeLessThanOrEqual(10 * MIN);
    expect(after.interview.rebuildOf).toEqual({ id: GUIDED, title: 'Cache-aside, version one' });
    expect(after.teach).toBe('');
  });

  test('starting again does not restart the clock', async () => {
    const first = (await get(`/api/levels/${IV}`)).json().interview.startedAt;
    await post(`/api/levels/${IV}/start`);
    expect((await get(`/api/levels/${IV}`)).json().interview.startedAt).toBe(first);
  });

  test('a hint costs XP, is counted and is reported; XP never goes below 0', async () => {
    await store.update((d) => void (d.xp = 250));
    const h1 = (await post(`/api/levels/${IV}/hint`)).json();
    expect(h1).toMatchObject({
      index: 0,
      revealed: 1,
      hintsTotal: 2,
      xpCost: 10,
      xp: 240,
      hintsBought: 1,
    });
    expect(store.current!.xp).toBe(240);
    await store.update((d) => void (d.xp = 3));
    const h2 = (await post(`/api/levels/${IV}/hint`)).json();
    expect(h2).toMatchObject({ index: 1, xpCost: 3, xp: 0, hintsBought: 2 });
    expect(store.current!.levels[IV]!.hintsBought).toBe(2);
    const lv = (await get(`/api/levels/${IV}`)).json();
    expect(lv.interview.hintsBought).toBe(2);
    expect((await post(`/api/levels/${IV}/hint`)).statusCode).toBe(409);
    expect(store.current!.xp).toBe(0);
    await store.update((d) => void (d.xp = 240));
  });

  test('a hint on a guided level is free and says nothing about cost', async () => {
    const xp0 = store.current!.xp;
    const h = (await post(`/api/levels/${GUIDED}/hint`)).json();
    expect(h.xpCost).toBeUndefined();
    expect(store.current!.xp).toBe(xp0);
  });

  test('past the deadline the view says overtime and remaining stays at zero', async () => {
    await ageClock(11);
    const lv = (await get(`/api/levels/${IV}`)).json();
    expect(lv.remainingMs).toBe(0);
    expect(lv.interview.overtime).toBe(true);
    expect(lv.status).toBe('in_progress');
  });

  test('a pass records the elapsed time and whether it was late, and the view freezes it', async () => {
    await ageClock(12);
    await post(`/api/levels/${IV}/complete`);
    const lp = store.current!.levels[IV]!;
    expect(lp.status).toBe('passed');
    expect(lp.overtime).toBe(true);
    expect(lp.interviewElapsedMs).toBeGreaterThanOrEqual(12 * MIN);
    const lv = (await get(`/api/levels/${IV}`)).json();
    expect(lv.interview).toMatchObject({ overtime: true });
    expect(lv.interview.elapsedMs).toBe(lp.interviewElapsedMs);
    expect(lv.remainingMs).toBe(0);
  });
});
