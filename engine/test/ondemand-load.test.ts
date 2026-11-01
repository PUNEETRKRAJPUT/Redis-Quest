// E-02: traffic on demand. The runner is a fake autocannon (resolves when told to, or when stop() is called), so the
// route, the guard, the events and the numbers are tested without a stack.
import { cp, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ErrorReply } from 'redis';
import pino from 'pino';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import type { Config } from '../src/config.js';
import { EventBus, type EngineEvent } from '../src/events.js';
import { LevelService } from '../src/levels.js';
import { OnDemandLoad } from '../src/load/ondemand.js';
import type { LoadRunResult, RunLoadOptions } from '../src/load/run.js';
import { MetricsStore } from '../src/metrics.js';
import { newProgress, ProgressStore, reconcileLevels } from '../src/progress.js';
import { buildServer } from '../src/server.js';
import { loadCaps } from '../src/verify/config.js';
import { eventMatches } from '../src/verify/events.js';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '../..');
const EXAMPLES = join(REPO, 'levels/_examples');

function result(p: Partial<LoadRunResult> = {}): LoadRunResult {
  return {
    startedAt: 0,
    finishedAt: 0,
    durationSec: 5,
    connections: 50,
    responses: 1200,
    ok2xx: 1190,
    non2xx: 10,
    status5xx: 4,
    connErrors: 1,
    timeouts: 0,
    p50Ms: 5,
    p99Ms: 42.5,
    rps: 240,
    errorRate: 0.004,
    statusCodes: {},
    ...p,
  };
}

/** A load run that ends when `finish()` is called or when its stop handle is used. */
function fakeRunner() {
  const calls: RunLoadOptions[] = [];
  let finish: (r?: LoadRunResult) => void = () => undefined;
  let stops = 0;
  const state = { failNext: false };
  const run = (o: RunLoadOptions) =>
    new Promise<LoadRunResult>((resolve, reject) => {
      calls.push(o);
      let done = false;
      finish = (r) => {
        if (done) return;
        done = true;
        resolve(r ?? result());
      };
      if (state.failNext) {
        state.failNext = false;
        reject(new Error('autocannon exploded'));
        return;
      }
      o.onStart?.({
        stop: () => {
          stops += 1;
          setTimeout(() => finish(result({ responses: 300, rps: 150 })), 5);
        },
      });
    });
  return { run, calls, state, finish: (r?: LoadRunResult) => finish(r), stops: () => stops };
}

const customEvents = (events: EngineEvent[], name: string) =>
  events
    .filter((e) => e.type === 'level.event')
    .map((e) => e.data as { kind: string; name?: string; data?: Record<string, unknown> })
    .filter((d) => d.kind === 'custom' && d.name === name);

describe('OnDemandLoad', () => {
  const cfg = {
    scenariosDir: join(REPO, 'scenarios'),
    appUrl: 'http://proxy:3000/app',
    caps: loadCaps({ LOAD_MAX_CONNECTIONS: '40', LOAD_MAX_DURATION_SEC: '8' }),
  };
  const make = () => {
    const bus = new EventBus();
    const events: EngineEvent[] = [];
    bus.subscribe((e) => events.push(e));
    const runner = fakeRunner();
    const od = new OnDemandLoad({ cfg, bus, runLoad: runner.run });
    return { od, runner, events };
  };

  test('starts in the background with the verifier caps, reports status, emits both events, keeps the last run', async () => {
    const { od, runner, events } = make();
    let released = 0;
    const started = await od.start(
      { scenario: 'toss-time-100', durationSec: 20 },
      () => void released++,
    );
    // 20 s is clamped to the cap (8 s here); connections default to the scenario's 50, clamped to 40.
    expect(started).toMatchObject({ scenario: 'toss-time-100', durationSec: 8, connections: 40 });
    expect(Date.parse(started.endsAt) - Date.parse(started.startedAt)).toBe(8000);
    expect(runner.calls[0]).toMatchObject({
      origin: 'http://proxy:3000',
      connections: 40,
      durationSec: 8,
    });
    // No warmup and no baseline: one run, nothing else.
    expect(runner.calls).toHaveLength(1);
    const running = od.status();
    expect(running).toMatchObject({ running: true, scenario: 'toss-time-100', last: null });
    expect(running.startedAt).toBe(started.startedAt);
    expect(customEvents(events, 'load_started')[0]?.data).toEqual({
      scenario: 'toss-time-100',
      durationSec: 8,
    });
    expect(released).toBe(0);

    runner.finish(result());
    for (let i = 0; i < 50 && od.status().running; i++) await new Promise((r) => setTimeout(r, 5));
    const done = od.status();
    expect(done.running).toBe(false);
    expect(done.scenario).toBeNull();
    expect(done.last).toMatchObject({
      scenario: 'toss-time-100',
      requests: 1200,
      rps: 240,
      p99Ms: 42.5,
      errors: 5,
      status5xx: 4,
    });
    expect(customEvents(events, 'load_finished')[0]?.data).toEqual({
      scenario: 'toss-time-100',
      requests: 1200,
      rps: 240,
      p99Ms: 42.5,
      errors: 5,
    });
    expect(released).toBe(1);
  });

  test('an explicit connections value is clamped to the cap, not refused', async () => {
    const { od, runner } = make();
    const s = await od.start(
      { scenario: 'toss-time-100', durationSec: 3, connections: 12 },
      () => undefined,
    );
    expect(s.connections).toBe(12);
    runner.finish();
    const s2 = await (async () => {
      for (let i = 0; i < 50 && od.status().running; i++)
        await new Promise((r) => setTimeout(r, 5));
      return od.start(
        { scenario: 'toss-time-100', durationSec: 3, connections: 500 },
        () => undefined,
      );
    })();
    expect(s2.connections).toBe(40);
    runner.finish();
  });

  test('stop ends a run early and still reports load_finished with the numbers it got', async () => {
    const { od, runner, events } = make();
    expect(await od.stop()).toEqual({ stopped: false });
    await od.start({ scenario: 'toss-time-100', durationSec: 8 }, () => undefined);
    expect(await od.stop()).toEqual({ stopped: true });
    expect(runner.stops()).toBe(1);
    expect(od.status().running).toBe(false);
    expect(od.status().last).toMatchObject({ requests: 300, rps: 150 });
    expect(customEvents(events, 'load_finished')).toHaveLength(1);
  });

  test('validation, and a failing run that never reports load_finished', async () => {
    const { od, events } = make();
    const bad = (req: Record<string, unknown>) =>
      od.start(req as never, () => undefined).catch((e: { code?: string; message: string }) => e);
    expect(await bad({ durationSec: 5 })).toMatchObject({ code: 'invalid_scenario' });
    expect(await bad({ scenario: 'toss-time-100' })).toMatchObject({ code: 'invalid_duration' });
    expect(await bad({ scenario: 'toss-time-100', durationSec: 0 })).toMatchObject({
      code: 'invalid_duration',
    });
    expect(await bad({ scenario: 'toss-time-100', durationSec: 31 })).toMatchObject({
      code: 'invalid_duration',
    });
    expect(await bad({ scenario: 'toss-time-100', durationSec: 2.5 })).toMatchObject({
      code: 'invalid_duration',
    });
    expect(await bad({ scenario: 'toss-time-100', durationSec: 5, connections: 0 })).toMatchObject({
      code: 'invalid_connections',
    });
    // A scenario that does not exist is the loader's own error (the route maps it to 400 invalid_scenario).
    expect(await bad({ scenario: 'no-such-scenario', durationSec: 5 })).toMatchObject({
      message: 'scenarios/no-such-scenario.yaml does not exist',
    });
    expect(od.status().running).toBe(false);
    expect(customEvents(events, 'load_started')).toHaveLength(0);
  });

  test('the events match a level `event custom load_finished` with match.scenario', () => {
    const data = {
      kind: 'custom' as const,
      name: 'load_finished',
      data: { scenario: 'toss-time-100', requests: 1, rps: 1, p99Ms: 1, errors: 0 },
    };
    const v = {
      kind: 'custom' as const,
      match: { name: 'load_finished', scenario: 'toss-time-100' },
    };
    expect(eventMatches(v, data)).toBe(true);
    expect(eventMatches({ ...v, match: { name: 'load_finished', scenario: 'other' } }, data)).toBe(
      false,
    );
  });
});

describe('routes: /api/load/*, the shared guard, and the BUSY / script_killed CLI events', () => {
  let root: string;
  let app: Awaited<ReturnType<typeof buildServer>>;
  const bus = new EventBus();
  const events: EngineEvent[] = [];
  const runner = fakeRunner();
  // What the engine's terminal connection answers while "Redis" is busy.
  let cliAnswer: (argv: string[]) => Promise<unknown> = async () => Buffer.from('OK');
  // While set, every engine-side Redis command waits for it, which holds a verification open.
  let gate: Promise<void> | null = null;
  const L1 = 'example-code-01-cache-aside';
  const get = (url: string) => app.inject({ method: 'GET', url });
  const post = (url: string, payload: unknown = {}) =>
    app.inject({ method: 'POST', url, payload: payload as object });
  const settle = async (ms = 60) => new Promise((r) => setTimeout(r, ms));

  beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), 'quest-e02-'));
    await cp(join(EXAMPLES, 'example-code'), join(root, 'levels', 'example-code'), {
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
    const levels = new LevelService(cfg.levelsDir);
    await levels.load();
    const store = new ProgressStore(cfg.progressDir);
    const p = newProgress({
      id: 'p-1',
      name: 'Asha',
      redisUrl: 'redis://fake',
      activeSlots: [],
      now: new Date(),
    });
    reconcileLevels(p, levels.orderedIds);
    await store.create(p);
    bus.subscribe((e) => events.push(e));
    app = await buildServer({
      cfg,
      log: pino({ level: 'silent' }),
      bus,
      store,
      redis: {
        url: 'redis://fake',
        isUp: true,
        send: async () => (gate ? gate.then(() => 'OK') : 'OK'),
        cliSend: (argv: string[]) => cliAnswer(argv),
        resetCli: () => undefined,
        onUp: () => undefined,
      } as never,
      mirror: { write: async () => undefined, setGift: async () => undefined } as never,
      levels,
      logtail: { attach: () => undefined, tail: async () => [] } as never,
      metrics: new MetricsStore(),
      runtime: { redisUrl: 'redis://fake', activeSlots: [], dbExtraLatencyMs: 0, boots: 1 },
      runLoad: runner.run,
    });
  });
  afterAll(async () => {
    await app.close();
    await rm(root, { recursive: true, force: true });
  });

  test('start answers 202, status shows the run, a second start is 409 with the new message', async () => {
    const r = await post('/api/load/start', { scenario: 'toss-time-100', durationSec: 5 });
    expect(r.statusCode).toBe(202);
    expect(r.json()).toMatchObject({ scenario: 'toss-time-100', durationSec: 5, connections: 50 });
    expect(Object.keys(r.json()).sort()).toEqual(
      ['connections', 'durationSec', 'endsAt', 'scenario', 'startedAt'].sort(),
    );
    const s = (await get('/api/load/status')).json();
    expect(s).toMatchObject({ running: true, scenario: 'toss-time-100', last: null });
    expect(s.endsAt).toBe(r.json().endsAt);

    const again = await post('/api/load/start', { scenario: 'toss-time-100', durationSec: 5 });
    expect(again.statusCode).toBe(409);
    expect(again.json()).toEqual({
      error: 'verify_in_progress',
      message: 'a verification or a traffic run is already running',
    });
    // A verification during the run is the same 409.
    expect((await post(`/api/levels/${L1}/start`)).statusCode).toBe(200);
    const v = await post(`/api/levels/${L1}/verify`);
    expect(v.statusCode).toBe(409);
    expect(v.json().error).toBe('verify_in_progress');

    runner.finish(result());
    await settle();
    const after = (await get('/api/load/status')).json();
    expect(after).toMatchObject({ running: false, scenario: null, startedAt: null, endsAt: null });
    expect(after.last).toMatchObject({
      requests: 1200,
      rps: 240,
      p99Ms: 42.5,
      errors: 5,
      status5xx: 4,
    });
    expect(customEvents(events, 'load_started')).toHaveLength(1);
    expect(customEvents(events, 'load_finished')).toHaveLength(1);
  });

  test('stop answers { stopped } and the guard is free afterwards', async () => {
    expect((await post('/api/load/stop')).json()).toEqual({ stopped: false });
    await post('/api/load/start', { scenario: 'toss-time-100', durationSec: 30 });
    expect((await post('/api/load/stop')).json()).toEqual({ stopped: true });
    expect((await get('/api/load/status')).json().running).toBe(false);
    expect(
      (await post('/api/load/start', { scenario: 'toss-time-100', durationSec: 1 })).statusCode,
    ).toBe(202);
    runner.finish();
    await settle();
  });

  test('bad bodies are 400 and release the guard', async () => {
    const codes = async (body: unknown) => {
      const r = await post('/api/load/start', body);
      return [r.statusCode, r.json().error];
    };
    expect(await codes({ scenario: 'toss-time-100', durationSec: 99 })).toEqual([
      400,
      'invalid_duration',
    ]);
    expect(await codes({ scenario: 'toss-time-100', durationSec: 5, connections: 'many' })).toEqual(
      [400, 'invalid_connections'],
    );
    expect(await codes({ scenario: 'nope', durationSec: 5 })).toEqual([400, 'invalid_scenario']);
    expect(await codes({})).toEqual([400, 'invalid_scenario']);
    // Every refusal above released the guard: a good start is accepted right after.
    expect(
      (await post('/api/load/start', { scenario: 'toss-time-100', durationSec: 1 })).statusCode,
    ).toBe(202);
    runner.finish();
    await settle();
  });

  test('a failing run releases the guard and says load_failed, never load_finished', async () => {
    const before = customEvents(events, 'load_finished').length;
    runner.state.failNext = true;
    expect(
      (await post('/api/load/start', { scenario: 'toss-time-100', durationSec: 2 })).statusCode,
    ).toBe(202);
    await settle();
    expect(customEvents(events, 'load_finished')).toHaveLength(before);
    expect(customEvents(events, 'load_failed').map((d) => d.data)).toEqual([
      { scenario: 'toss-time-100', message: 'autocannon exploded' },
    ]);
    expect((await get('/api/load/status')).json()).toMatchObject({ running: false });
    expect(
      (await post('/api/load/start', { scenario: 'toss-time-100', durationSec: 1 })).statusCode,
    ).toBe(202);
    runner.finish();
    await settle();
  });

  test('a verification holds the guard: start during it is 409', async () => {
    let release!: () => void;
    gate = new Promise<void>((r) => (release = r));
    const pending = post(`/api/levels/${L1}/verify`);
    for (
      let i = 0;
      i < 50 && !events.some((e) => JSON.stringify(e.data).includes('verify_started'));
      i++
    )
      await settle(10);
    const busy = await post('/api/load/start', { scenario: 'toss-time-100', durationSec: 5 });
    expect(busy.statusCode).toBe(409);
    release();
    gate = null;
    await pending;
    expect(
      (await post('/api/load/start', { scenario: 'toss-time-100', durationSec: 1 })).statusCode,
    ).toBe(202);
    runner.finish();
    await settle();
  });

  test('POST /api/cli: a BUSY reply is an error line and emits redis_busy; SCRIPT KILL OK emits script_killed', async () => {
    cliAnswer = async () => {
      throw new ErrorReply(
        'BUSY Redis is busy running a script. You can only call SCRIPT KILL or SHUTDOWN NOSAVE.',
      );
    };
    const busy = await post('/api/cli', { command: 'PING' });
    expect(busy.statusCode).toBe(200);
    expect(busy.json()).toMatchObject({ type: 'error' });
    expect(busy.json().reply).toMatch(/^\(error\) BUSY Redis is busy/);
    expect(customEvents(events, 'redis_busy').map((d) => d.data)).toEqual([{ command: 'PING' }]);
    expect(customEvents(events, 'script_killed')).toHaveLength(0);

    cliAnswer = async () => Buffer.from('OK');
    const kill = await post('/api/cli', { command: 'SCRIPT KILL' });
    expect(kill.json()).toMatchObject({ reply: 'OK', type: 'status' });
    expect(customEvents(events, 'script_killed').map((d) => d.data)).toEqual([
      { command: 'SCRIPT KILL' },
    ]);
    // An ordinary OK is not a kill, and an ordinary reply is not BUSY.
    await post('/api/cli', { command: 'SET a 1' });
    expect(customEvents(events, 'script_killed')).toHaveLength(1);
    expect(customEvents(events, 'redis_busy')).toHaveLength(1);
  });
});
