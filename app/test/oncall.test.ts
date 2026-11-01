import { copyFileSync, mkdirSync, rmSync, utimesSync } from 'node:fs';
import path from 'node:path';
import { createClient } from 'redis';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import {
  FIXTURES,
  REDIS_URL,
  sleep,
  startApp,
  startStubEngine,
  tempDir,
  waitFor,
  type RunningApp,
  type StubEngine,
} from './harness.js';

// Chapter 4b app surface (A-04): the planted faults (KEYS, no TTL, a Lua loop, a client per request) and the
// two repair slots, with the reference fixtures as the repairs. The app runs with a short ONCALL_SPIN_MS and a
// small ONCALL_LEAK_CAP so nothing here blocks Redis for long.

let engine: StubEngine;
let app: RunningApp;
let ws: string;
let logDir: string;
const redis = createClient({ url: REDIS_URL });

interface Res {
  status: number;
  headers: Headers;
  body: Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
}

async function call(p: string, init?: RequestInit): Promise<Res> {
  const res = await fetch(`${app.url}${p}`, init);
  const text = await res.text();
  let body: unknown = text;
  try {
    body = JSON.parse(text);
  } catch {
    /* not JSON */
  }
  return { status: res.status, headers: res.headers, body: body as Res['body'] };
}
const post = (p: string, body: unknown): Promise<Res> =>
  call(p, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });

async function setConfig(activeSlots: string[]): Promise<void> {
  engine.config = { ...engine.config, activeSlots };
  const want = `"${engine.etag()}"`;
  await waitFor(
    `app to apply config ${want}`,
    async () => ((await call('/app/health')).body.configEtag as string | null) === want,
  );
  for (const name of activeSlots) {
    await waitFor(`slot ${name} loaded`, async () => {
      const s = await call('/app/slots');
      const slot = (s.body.slots as Array<{ name: string; state: string }>).find(
        (x) => x.name === name,
      );
      return slot?.state === 'loaded';
    });
  }
}

function install(fixture: string): void {
  mkdirSync(path.join(ws, 'ch4b'), { recursive: true });
  const dest = path.join(ws, 'ch4b', fixture);
  copyFileSync(path.join(FIXTURES, fixture), dest);
  const t = new Date(Date.now() + Math.floor(Math.random() * 1000));
  utimesSync(dest, t, t);
}

const FIXTURE_FILES = [
  'count-users.js',
  'record-view.js',
  'add-ttls.js',
  'recompute-badges.js',
  'lookup-team.js',
  'split-big-key.js',
];
const ALL_SLOTS = [
  'oncall.countUsers',
  'oncall.recordView',
  'oncall.addTtls',
  'oncall.recomputeBadges',
  'oncall.lookupTeam',
  'oncall.splitBigKey',
];
const LB = ['lb:match:m-a04-1', 'lb:match:m-a04-2'];
const KEYS = [...LB, 'badges:fifties', 'team:t-a04', 'a04t:big', 'a04t:big:{0}'];
async function cleanup(): Promise<void> {
  const patterns = ['a04t:*', 'view:a04t-*', 'a04team:*'];
  const found: string[] = [];
  for (const p of patterns) found.push(...(await redis.keys(p)));
  await redis.del([...KEYS, ...found]);
}

beforeAll(async () => {
  await redis.connect();
  await cleanup();
  ws = tempDir('ws-ch4b');
  logDir = tempDir('logs-ch4b');
  engine = await startStubEngine({
    target: { redisUrl: REDIS_URL },
    activeSlots: [],
    dbExtraLatencyMs: 0,
  });
  app = await startApp({
    engineUrl: engine.url,
    workspaceDir: ws,
    logDir,
    env: { ONCALL_SPIN_MS: '1200', ONCALL_LEAK_CAP: '5' },
  });
}, 30_000);

afterAll(async () => {
  await app?.stop();
  await engine?.close();
  await cleanup();
  await redis.close();
  rmSync(ws, { recursive: true, force: true });
  rmSync(logDir, { recursive: true, force: true });
});

describe('registry rows', () => {
  test('the six Chapter 4b slots declare the contracted file and signature', async () => {
    const { SLOTS } = await import('../src/slots/registry.js');
    const rows = Object.fromEntries(SLOTS.map((s) => [s.name, `${s.file} ${s.signature}`]));
    expect(rows).toMatchObject({
      'oncall.countUsers': 'ch4b/count-users.js (deps, prefix)',
      'oncall.recordView': 'ch4b/record-view.js (deps, userId, matchId)',
      'oncall.addTtls': 'ch4b/add-ttls.js (deps, pattern, seconds)',
      'oncall.recomputeBadges': 'ch4b/recompute-badges.js (deps)',
      'oncall.lookupTeam': 'ch4b/lookup-team.js (deps, teamId)',
      'oncall.splitBigKey': 'ch4b/split-big-key.js (deps, key, buckets)',
    });
  });

  test('ONCALL_SPIN_MS is bounded', async () => {
    const { oncallSpinMs } = await import('../src/slots/baselines.js');
    expect(oncallSpinMs({})).toBe(20_000);
    expect(oncallSpinMs({ ONCALL_SPIN_MS: '1500' })).toBe(1500);
    expect(oncallSpinMs({ ONCALL_SPIN_MS: '9999999' })).toBe(120_000);
    expect(oncallSpinMs({ ONCALL_SPIN_MS: 'abc' })).toBe(20_000);
    expect(oncallSpinMs({ ONCALL_SPIN_MS: '0' })).toBe(1);
  });
});

describe('route validation', () => {
  test('count: prefix rules', async () => {
    expect((await call('/app/oncall/users/count')).status).toBe(400);
    for (const prefix of ['game:x', 'g', 'game', 'a*', 'x[y', 'a?']) {
      const r = await call(`/app/oncall/users/count?prefix=${encodeURIComponent(prefix)}`);
      expect(r.status, prefix).toBe(400);
    }
    expect((await call(`/app/oncall/users/count?prefix=${'x'.repeat(65)}`)).status).toBe(400);
  });

  test('views, ttl-sweep, split, teams', async () => {
    expect((await post('/app/oncall/views', { userId: 'u', matchId: 'a b' })).status).toBe(400);
    expect((await post('/app/oncall/views', { matchId: 'm' })).status).toBe(400);
    for (const pattern of ['*', 'g*', 'game:*', 'ga?e:x', '[g]ame:*', '?ame:x', '']) {
      const r = await post('/app/oncall/ttl-sweep', { pattern, seconds: 60 });
      expect(r.status, pattern).toBe(400);
    }
    for (const seconds of [0, 604_801, 1.5, '60']) {
      expect((await post('/app/oncall/ttl-sweep', { pattern: 'view:*', seconds })).status).toBe(
        400,
      );
    }
    expect((await post('/app/oncall/split', { key: 'game:x', buckets: 8 })).status).toBe(400);
    expect((await post('/app/oncall/split', { key: 'k', buckets: 1 })).status).toBe(400);
    expect((await post('/app/oncall/split', { key: 'k', buckets: 1025 })).status).toBe(400);
    expect((await call('/app/oncall/teams/a%20b')).status).toBe(400);
  });
});

describe('the planted faults (baselines)', () => {
  test('countUsers uses KEYS and counts', async () => {
    const m = redis.multi();
    for (let i = 0; i < 25; i++) m.set(`a04t:user:${i}`, 'x');
    await m.execAsPipeline();
    const r = await call('/app/oncall/users/count?prefix=a04t:user:');
    expect(r.status).toBe(200);
    expect(r.body).toEqual({ prefix: 'a04t:user:', count: 25 });
    expect(r.headers.get('x-quest-slots')).toBe('oncall.countUsers=baseline');
  });

  test('recordView writes no TTL', async () => {
    for (let i = 0; i < 5; i++)
      expect(
        (await post('/app/oncall/views', { userId: `a04t-u${i}`, matchId: 'm-1' })).status,
      ).toBe(200);
    const keys = await redis.keys('view:a04t-*');
    expect(keys).toHaveLength(5);
    for (const k of keys) expect(await redis.ttl(k)).toBe(-1);
  });

  test('addTtls and splitBigKey baselines do nothing', async () => {
    const t = await post('/app/oncall/ttl-sweep', { pattern: 'view:a04t-*', seconds: 60 });
    expect(t.body).toEqual({ expired: 0 });
    const s = await post('/app/oncall/split', { key: 'a04t:big', buckets: 4 });
    expect(s.status).toBe(200);
    expect(s.body).toEqual({ key: 'a04t:big', fields: 0, buckets: 0 });
  });

  test('lookupTeam leaks a client per call, up to the cap, and 404s a missing team', async () => {
    await redis.hSet('team:t-a04', { id: 't-a04', name: 'Test XI' });
    expect((await call('/app/oncall/status')).body.leakedClients).toBe(0);
    for (let i = 0; i < 3; i++) {
      const r = await call('/app/oncall/teams/t-a04');
      expect(r.body).toEqual({ id: 't-a04', name: 'Test XI' });
    }
    expect((await call('/app/oncall/status')).body.leakedClients).toBe(3);
    const before = Number(
      ((await redis.info('clients')).match(/connected_clients:(\d+)/) ?? [])[1],
    );
    for (let i = 0; i < 5; i++) await call('/app/oncall/teams/t-a04');
    const status = (await call('/app/oncall/status')).body;
    expect(status.leakedClients).toBe(5); // ONCALL_LEAK_CAP=5 closes the oldest
    expect(status.instance).toMatch(/^test-/);
    await sleep(300);
    const after = Number(((await redis.info('clients')).match(/connected_clients:(\d+)/) ?? [])[1]);
    expect(after).toBeGreaterThanOrEqual(before); // 2 more leaked, 3 closed: not growing without bound
    expect(after - before).toBeLessThanOrEqual(5);
    const missing = await call('/app/oncall/teams/t-nope');
    expect(missing.status).toBe(404);
    expect(missing.body.error).toBe('team_not_found');
  });

  test('recomputeBadges: spins read-only for ONCALL_SPIN_MS, blocks Redis, then answers done', async () => {
    const t0 = Date.now();
    const r = await post('/app/oncall/badges/recompute', {});
    const ms = Date.now() - t0;
    // 1200 ms spin is inside the 2 s learner command timeout, so this one completes.
    expect(r.status).toBe(200);
    expect(r.body).toEqual({ ok: true, result: 'done' });
    expect(ms).toBeGreaterThanOrEqual(1100);
  });

  test('recomputeBadges: a spin longer than the 2 s command timeout answers 500 while Redis stays blocked', async () => {
    // A second app instance with a 4 s spin (the shared one is pinned at 1.2 s for the test above).
    const long = await startApp({
      engineUrl: engine.url,
      workspaceDir: ws,
      logDir,
      env: { ONCALL_SPIN_MS: '4000' },
    });
    const probe = createClient({ url: REDIS_URL });
    probe.on('error', () => undefined);
    await probe.connect(); // connected before the script starts: a new connection would wait behind it too
    try {
      const t0 = Date.now();
      const res = await fetch(`${long.url}/app/oncall/badges/recompute`, { method: 'POST' });
      const body = (await res.json()) as { error: string; message: string };
      const ms = Date.now() - t0;
      expect(res.status).toBe(500);
      expect(body.message).toMatch(/eval got no reply within 2000 ms/);
      expect(ms).toBeGreaterThanOrEqual(1900);
      expect(ms).toBeLessThan(3500);
      // The script is still running inside Redis: this PING waits for the rest of the 4 s spin.
      const t1 = Date.now();
      await probe.ping();
      expect(Date.now() - t1).toBeGreaterThanOrEqual(500);
    } finally {
      await probe.close();
      await long.stop();
    }
    await sleep(500);
    expect(await redis.ping()).toBe('PONG');
  }, 30_000);
});

describe('the repairs (reference fixtures through the learner path)', () => {
  beforeAll(async () => {
    for (const f of FIXTURE_FILES) install(f);
    await setConfig(ALL_SLOTS);
  });

  test('countUsers via SCAN counts the same keys', async () => {
    const r = await call('/app/oncall/users/count?prefix=a04t:user:');
    expect(r.body.count).toBe(25);
    expect(r.headers.get('x-quest-slots')).toContain('oncall.countUsers=learner');
  });

  test('recordView sets a TTL; addTtls adds one to old keys', async () => {
    await post('/app/oncall/views', { userId: 'a04t-new', matchId: 'm-1' });
    expect(await redis.ttl('view:a04t-new:m-1')).toBeGreaterThan(0);
    const swept = await post('/app/oncall/ttl-sweep', { pattern: 'view:a04t-*', seconds: 600 });
    expect(swept.body).toEqual({ expired: 5 }); // the five old ones; the new one already had a TTL
    for (const k of await redis.keys('view:a04t-*')) expect(await redis.ttl(k)).toBeGreaterThan(0);
  });

  test('recomputeBadges fills badges:fifties without EVAL', async () => {
    await redis.zAdd(LB[0]!, [
      { score: 10, value: 'a' },
      { score: 50, value: 'b' },
      { score: 71, value: 'c' },
    ]);
    await redis.zAdd(LB[1]!, [{ score: 100, value: 'a' }]);
    const t0 = Date.now();
    const r = await post('/app/oncall/badges/recompute', {});
    expect(r.status).toBe(200);
    expect(Date.now() - t0).toBeLessThan(1000);
    expect(await redis.hGet('badges:fifties', 'm-a04-1')).toBe('2');
    expect(await redis.hGet('badges:fifties', 'm-a04-2')).toBe('1');
  });

  test('lookupTeam via the shared client leaks nothing', async () => {
    const leaked = (await call('/app/oncall/status')).body.leakedClients as number;
    for (let i = 0; i < 6; i++) {
      expect((await call('/app/oncall/teams/t-a04')).body).toEqual({
        id: 't-a04',
        name: 'Test XI',
      });
    }
    expect((await call('/app/oncall/status')).body.leakedClients).toBe(leaked);
    expect((await call('/app/oncall/teams/t-nope')).status).toBe(404);
  });

  test('splitBigKey spreads the hash over the buckets and removes the original', async () => {
    const m = redis.multi();
    for (let i = 0; i < 3000; i++) m.hSet('a04t:big', `f${i}`, String(i));
    await m.execAsPipeline();
    const r = await post('/app/oncall/split', { key: 'a04t:big', buckets: 8 });
    expect(r.status).toBe(200);
    expect(r.body.fields).toBe(3000);
    expect(r.body.buckets).toBe(8);
    expect(await redis.exists('a04t:big')).toBe(0);
    let total = 0;
    for (let n = 0; n < 8; n++) total += await redis.hLen(`a04t:big:${n}`);
    expect(total).toBe(3000);
  });

  test('a wrong return is a slot contract error', async () => {
    const { writeFileSync } = await import('node:fs');
    const write = (file: string, src: string): void => {
      const dest = path.join(ws, 'ch4b', file);
      writeFileSync(dest, src);
      const t = new Date(Date.now() + 5000 + Math.floor(Math.random() * 1000));
      utimesSync(dest, t, t);
    };
    write('count-users.js', 'export default async () => "7";\n');
    write('lookup-team.js', 'export default async () => ({ id: 1 });\n');
    write('split-big-key.js', 'export default async () => ({ fields: -1, buckets: 0 });\n');
    await sleep(1500);
    for (const p of ['/app/oncall/users/count?prefix=a04t:', '/app/oncall/teams/t-a04']) {
      const r = await call(p);
      expect(r.status, p).toBe(500);
      expect(r.headers.get('x-quest-slot-error')).toMatch(/must return/);
    }
    const s = await post('/app/oncall/split', { key: 'a04t:big', buckets: 4 });
    expect(s.status).toBe(500);
    expect(s.headers.get('x-quest-slot-error')).toMatch(/must return/);
  });
});
