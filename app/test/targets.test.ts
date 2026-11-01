import { copyFileSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import pino from 'pino';
import { createClient } from 'redis';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { parseAppConfig } from '../src/engine.js';
import { RedisTarget } from '../src/redis.js';
import {
  FIXTURES,
  REDIS_URL,
  startApp,
  startStubEngine,
  tempDir,
  waitFor,
  type RunningApp,
  type StubEngine,
} from './harness.js';

// A-05: the app follows replica, sentinel and cluster targets. The unit part needs no server; the live part runs
// the built app against a stub engine and points it at targets that do not exist, which is enough to prove the
// kind is parsed, reported and survived (the real sentinel and cluster runs are in scripts/check/A-05.sh).

describe('parseAppConfig accepts every target scheme', () => {
  const base = { activeSlots: [], dbExtraLatencyMs: 0 };
  test.each([
    'redis://redis:6379',
    'rediss://redis:6380/2',
    'sentinel://mymaster@sentinel-1:26379,sentinel-2:26379,sentinel-3:26379',
    'cluster://redis-c1:6379,redis-c2:6379,redis-c3:6379',
  ])('%s', (redisUrl) => {
    expect(parseAppConfig({ ...base, target: { redisUrl } }).target.redisUrl).toBe(redisUrl);
  });
  test.each(['http://x:1', 'sentinel://nohost', 'cluster://', 'not a url', ''])(
    'rejects %j',
    (redisUrl) => {
      expect(() => parseAppConfig({ ...base, target: { redisUrl } })).toThrow(/target\.redisUrl/);
    },
  );
});

describe('RedisTarget', () => {
  const log = pino({ level: 'silent' });
  test('view() names the kind; a bad switch throws and keeps the current target', async () => {
    const t = new RedisTarget(REDIS_URL, log);
    try {
      expect(t.kind).toBe('single');
      expect(t.view()).toMatchObject({
        redisUrl: REDIS_URL,
        kind: 'single',
        ready: expect.any(Boolean),
      });
      expect(t.description).toMatch(/^single node /);
      await expect(t.switchTo('http://nope:1')).rejects.toThrow(/unsupported scheme/);
      expect(t.url).toBe(REDIS_URL);
      await t.switchTo('cluster://127.0.0.1:1,127.0.0.1:2');
      expect(t.kind).toBe('cluster');
      expect(t.description).toBe('cluster, 2 root nodes');
      expect(t.ready).toBe(false);
      await t.switchTo('sentinel://mymaster@127.0.0.1:1');
      expect(t.view()).toMatchObject({ kind: 'sentinel', ready: false });
      await t.switchTo(REDIS_URL);
      expect(t.kind).toBe('single');
      await waitFor('single client ready again', () => t.ready, 5000);
    } finally {
      await t.close();
    }
  });

  test('learner exposes the shared client, the cached one and the url (Sentinel duplicates need it)', async () => {
    const t = new RedisTarget(REDIS_URL, log);
    try {
      const l = t.learner;
      expect(l.redis).toBe(t.shared);
      expect(l.redisCached).toBe(t.cached);
      expect(l.redisUrl).toBe(REDIS_URL);
    } finally {
      await t.close();
    }
  });
});

describe('the built app on targets that are not there', () => {
  let engine: StubEngine;
  let app: RunningApp;
  let ws: string;
  let logDir: string;
  const get = async (p: string) => {
    const res = await fetch(`${app.url}${p}`);
    return { status: res.status, body: (await res.json()) as Record<string, unknown> };
  };
  const setTarget = async (redisUrl: string) => {
    engine.config = { ...engine.config, target: { redisUrl } };
    await waitFor(
      `app to follow ${redisUrl}`,
      async () => ((await get('/app/target')).body.redisUrl as string) === redisUrl,
    );
  };

  beforeAll(async () => {
    ws = tempDir('ws');
    logDir = tempDir('logs');
    engine = await startStubEngine({
      target: { redisUrl: REDIS_URL },
      activeSlots: [],
      dbExtraLatencyMs: 0,
    });
    app = await startApp({ engineUrl: engine.url, workspaceDir: ws, logDir });
  }, 30_000);
  afterAll(async () => {
    await app?.stop();
    await engine?.close();
    rmSync(ws, { recursive: true, force: true });
    rmSync(logDir, { recursive: true, force: true });
  });

  test('GET /app/target and /app/health report the kind on a single node', async () => {
    await waitFor('ready', async () => (await get('/app/target')).body.ready === true);
    const t = (await get('/app/target')).body;
    expect(t).toMatchObject({ redisUrl: REDIS_URL, kind: 'single', ready: true });
    expect(String(t.description)).toMatch(/^single node /);
    const h = (await get('/app/health')).body as { target: Record<string, unknown>; redis: string };
    expect(h.target).toMatchObject({ redisUrl: REDIS_URL, kind: 'single' });
    expect(h.redis).toBe('up');
  });

  test('a cluster and a sentinel target are followed; baselines keep serving; the app does not crash', async () => {
    await setTarget('cluster://127.0.0.1:1,127.0.0.1:2');
    let t = (await get('/app/target')).body;
    expect(t).toMatchObject({
      kind: 'cluster',
      description: 'cluster, 2 root nodes',
      ready: false,
    });
    expect(((await get('/app/health')).body as { redis: string }).redis).toBe('down');
    expect((await get('/app/players/p-001')).status).toBe(200);
    await setTarget('sentinel://mymaster@127.0.0.1:1,127.0.0.1:2');
    t = (await get('/app/target')).body;
    expect(t).toMatchObject({
      kind: 'sentinel',
      description: 'sentinel mymaster via 2 sentinels',
      ready: false,
    });
    expect((await get('/app/players/p-001')).status).toBe(200);
    await setTarget(REDIS_URL);
    await waitFor(
      'back on the single node',
      async () => (await get('/app/target')).body.ready === true,
    );
  });

  test('a learner write that cannot reach Redis fails with an ordinary 500, not a hang', async () => {
    mkdirSync(path.join(ws, 'ch3'), { recursive: true });
    writeFileSync(
      path.join(ws, 'ch3', 'leaderboard.js'),
      'export default async function top({ redis }) { await redis.set("{a}:1", "1"); return []; }\n',
    );
    engine.config = { ...engine.config, activeSlots: ['leaderboard.top'] };
    await setTarget('cluster://127.0.0.1:1,127.0.0.1:2');
    await waitFor('slot loaded', async () => {
      const s = (await get('/app/slots')).body.slots as Array<{ name: string; state: string }>;
      return s.find((x) => x.name === 'leaderboard.top')?.state === 'loaded';
    });
    const t0 = Date.now();
    const r = await get('/app/leaderboard/1?limit=3');
    expect(r.status).toBe(500);
    expect(Date.now() - t0).toBeLessThan(6000);
    expect(r.body.error).toBe('slot_error');
    await setTarget(REDIS_URL);
  });
  test('contest-join-cluster.js (hash tags + one Lua script) takes exactly 10 of 50 parallel joins', async () => {
    // On a single node the hash tags change nothing, so this proves the script's logic; the cluster run is in
    // scripts/check/A-05.sh.
    mkdirSync(path.join(ws, 'ch3'), { recursive: true });
    copyFileSync(
      path.join(FIXTURES, 'contest-join-cluster.js'),
      path.join(ws, 'ch3', 'contest-join.js'),
    );
    engine.config = { ...engine.config, activeSlots: ['contest.join'] };
    await waitFor('slot loaded', async () => {
      const s = (await get('/app/slots')).body.slots as Array<{ name: string; state: string }>;
      return s.find((x) => x.name === 'contest.join')?.state === 'loaded';
    });
    const r = createClient({ url: REDIS_URL });
    await r.connect();
    try {
      await r.del(['{wallet:u-a05}', '{wallet:u-a05}:joins:9001']);
      await r.set('{wallet:u-a05}', '100');
      const codes = await Promise.all(
        Array.from({ length: 50 }, async () => {
          const res = await fetch(`${app.url}/app/contests/9001/join`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ userId: 'u-a05' }),
          });
          return res.status;
        }),
      );
      expect({
        ok: codes.filter((c) => c === 200).length,
        refused: codes.filter((c) => c === 402).length,
      }).toEqual({ ok: 10, refused: 40 });
      expect(await r.get('{wallet:u-a05}')).toBe('0');
      expect(await r.get('{wallet:u-a05}:joins:9001')).toBe('10');
      await r.del(['{wallet:u-a05}', '{wallet:u-a05}:joins:9001']);
    } finally {
      await r.close();
    }
  });
});
