// E-01: the service_scaled emitter (fake pushes, fake clock) and the "run my code in the app" route.
import { cp, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import pino from 'pino';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import type { Config } from '../src/config.js';
import { EventBus, type EngineEvent } from '../src/events.js';
import { eventMatches } from '../src/verify/events.js';
import { LevelService } from '../src/levels.js';
import { LIVE_INSTANCE_MS, MetricsStore } from '../src/metrics.js';
import { newProgress, ProgressStore, reconcileLevels } from '../src/progress.js';
import { buildServer } from '../src/server.js';

const EXAMPLES = join(dirname(fileURLToPath(import.meta.url)), '../../levels/_examples');
const T0 = Date.parse('2026-11-01T10:00:00.000Z');
const beat = (instanceId: string, at: number) => ({ instanceId, at, routes: {} });

describe('MetricsStore scale detection', () => {
  test('1 to 2 emits once, the same id again does not, 6 s of silence emits 2 to 1', () => {
    const m = new MetricsStore();
    const calls: Array<[number, number, string[]]> = [];
    m.onScale((prev, now, ids) => calls.push([prev, now, ids]));

    m.push(beat('a', T0), T0);
    expect(calls).toEqual([[0, 1, ['a']]]);
    m.push(beat('b', T0 + 1000), T0 + 1000);
    expect(calls[1]).toEqual([1, 2, ['a', 'b']]);
    m.push(beat('b', T0 + 2000), T0 + 2000); // same id again: no change
    m.push(beat('a', T0 + 2000), T0 + 2000);
    expect(calls).toHaveLength(2);

    // b goes quiet after T0 + 2000; a keeps pushing.
    m.push(beat('a', T0 + 6000), T0 + 6000);
    m.checkScale(T0 + 2000 + LIVE_INSTANCE_MS); // exactly 5 s old is still live
    expect(calls).toHaveLength(2);
    m.checkScale(T0 + 2000 + LIVE_INSTANCE_MS + 1000);
    expect(calls[2]).toEqual([2, 1, ['a']]);
    m.checkScale(T0 + 9000);
    expect(calls).toHaveLength(3);
  });

  test('a listener that throws does not break ingestion', () => {
    const m = new MetricsStore();
    m.onScale(() => {
      throw new Error('boom');
    });
    expect(() => m.push(beat('a', T0), T0)).not.toThrow();
    expect(m.summary(60, T0).instances).toEqual(['a']);
  });

  test('the emitted payload matches a level `match: { service: app, instances: 2 }`', () => {
    const data = {
      kind: 'service_scaled' as const,
      data: { service: 'app', instances: 2, previous: 1, ids: ['a', 'b'] },
    };
    const v = { kind: 'service_scaled' as const, match: { service: 'app', instances: 2 } };
    expect(eventMatches(v, data)).toBe(true);
    expect(eventMatches({ ...v, match: { service: 'app', instances: 3 } }, data)).toBe(false);
  });
});

describe('server wiring and POST /api/levels/:id/slots', () => {
  let root: string;
  let app: Awaited<ReturnType<typeof buildServer>>;
  let store: ProgressStore;
  const bus = new EventBus();
  const metrics = new MetricsStore();
  const events: EngineEvent[] = [];
  // While set, every Redis command waits for it: that is how the test holds a verification open.
  let gate: Promise<void> | null = null;
  const L1 = 'example-code-01-cache-aside';
  const L2 = 'example-code-02-token-bucket';
  const get = (url: string) => app.inject({ method: 'GET', url });
  const post = (url: string, payload: unknown = {}) =>
    app.inject({ method: 'POST', url, payload: payload as object });

  beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), 'quest-e01-'));
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
    expect(levels.errors).toEqual([]);
    store = new ProgressStore(cfg.progressDir);
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
        onUp: () => undefined,
      } as never,
      mirror: { write: async () => undefined, setGift: async () => undefined } as never,
      levels,
      logtail: { attach: () => undefined, tail: async () => [] } as never,
      metrics,
      runtime: { redisUrl: 'redis://fake', activeSlots: [], dbExtraLatencyMs: 0, boots: 1 },
    });
  });
  afterAll(async () => {
    await app.close();
    await rm(root, { recursive: true, force: true });
  });

  test('a push makes the server emit service_scaled with the documented payload', () => {
    metrics.push(beat('app-1', Date.now()));
    const e = events.find((x) => x.type === 'level.event');
    expect(e?.data).toEqual({
      kind: 'service_scaled',
      data: { service: 'app', instances: 1, previous: 0, ids: ['app-1'] },
    });
  });

  test('refuses a level that is not started, then a locked one', async () => {
    expect((await post(`/api/levels/${L1}/slots`, { active: true })).statusCode).toBe(409);
    expect((await post(`/api/levels/${L2}/slots`, { active: true })).statusCode).toBe(409);
  });

  test('on, off, union with other slots, validation', async () => {
    expect((await post(`/api/levels/${L1}/start`)).statusCode).toBe(200);
    const before = (await get(`/api/levels/${L1}`)).json();
    expect(before.slots.active).toBe(false);
    expect(before.slots.own.length).toBeGreaterThan(0);

    expect((await post(`/api/levels/${L1}/slots`, { active: 'yes' })).statusCode).toBe(400);
    expect((await post(`/api/levels/${L1}/slots`, {})).statusCode).toBe(400);

    store.current!.activeSlots = ['other.slot'];
    const on = await post(`/api/levels/${L1}/slots`, { active: true });
    expect(on.statusCode).toBe(200);
    const own: string[] = before.slots.own;
    expect(on.json()).toEqual({ active: ['other.slot', ...own], own });
    expect((await get('/api/slots')).json().active).toEqual(['other.slot', ...own]);
    expect((await get(`/api/levels/${L1}`)).json().slots).toEqual({ own, active: true });
    expect(store.current!.activeSlots).toEqual(['other.slot', ...own]);

    const off = await post(`/api/levels/${L1}/slots`, { active: false });
    expect(off.json()).toEqual({ active: ['other.slot'], own });
    expect((await get(`/api/levels/${L1}`)).json().slots).toEqual({ own, active: false });
  });

  test('answers 409 verify_in_progress while a verification runs, then works again', async () => {
    let release!: () => void;
    gate = new Promise<void>((r) => (release = r));
    const verifyPending = post(`/api/levels/${L1}/verify`);
    for (
      let i = 0;
      i < 50 && !events.some((e) => JSON.stringify(e.data).includes('verify_started'));
      i++
    )
      await new Promise((r) => setTimeout(r, 10));
    const busy = await post(`/api/levels/${L1}/slots`, { active: true });
    expect(busy.statusCode).toBe(409);
    expect(busy.json().error).toBe('verify_in_progress');
    release();
    gate = null;
    await verifyPending;
    expect((await post(`/api/levels/${L1}/slots`, { active: true })).statusCode).toBe(200);
  });
});
