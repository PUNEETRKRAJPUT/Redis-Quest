import { copyFileSync, mkdirSync, readFileSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
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

const STATS_COLUMNS = [
  'player_id',
  'name',
  'team_id',
  'role',
  'matches_played',
  'innings_batted',
  'runs',
  'balls_faced',
  'fours',
  'sixes',
  'dismissals',
  'batting_avg',
  'strike_rate',
  'balls_bowled',
  'runs_conceded',
  'wickets',
  'economy',
  'selected_count',
  'selected_pct',
  'captain_pct',
  'last5_selected_pct',
  'last5_points',
  'avg_team_points',
  'last5_avg_team_points',
];

let engine: StubEngine;
let app: RunningApp;
let ws: string;
let logDir: string;
const redis = createClient({ url: REDIS_URL });

/** Put a fixture in place as the learner's ch2/cache.js, with a fresh mtime so the poller sees it. */
function installCache(fixture: string): void {
  mkdirSync(path.join(ws, 'ch2'), { recursive: true });
  const dest = path.join(ws, 'ch2', 'cache.js');
  copyFileSync(path.join(FIXTURES, fixture), dest);
  const t = new Date(Date.now() + Math.floor(Math.random() * 1000));
  utimesSync(dest, t, t);
}

async function get(p: string, init?: RequestInit) {
  const res = await fetch(`${app.url}${p}`, init);
  const text = await res.text();
  let body: unknown = text;
  try {
    body = JSON.parse(text);
  } catch {
    /* not JSON */
  }
  return { status: res.status, headers: res.headers, body: body as Record<string, unknown> };
}

async function health() {
  return (await get('/app/health')).body as {
    activeSlots: string[];
    configEtag: string | null;
    target: { redisUrl: string };
    redis: string;
  };
}

/** Change the stub engine's config and wait until the app reports it applied that ETag. */
async function setConfig(patch: Partial<StubEngine['config']>): Promise<void> {
  engine.config = { ...engine.config, ...patch };
  const want = `"${engine.etag()}"`;
  await waitFor(`app to apply config ${want}`, async () => (await health()).configEtag === want);
}

beforeAll(async () => {
  await redis.connect();
  await redis.del(['test:p07:calls', 'cache:player-stats:p-028', 'cache:player-stats:p-151']);
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
  await redis
    .del(['test:p07:calls', 'cache:player-stats:p-028', 'cache:player-stats:p-151'])
    .catch(() => 0);
  await redis.close();
  rmSync(ws, { recursive: true, force: true });
  rmSync(logDir, { recursive: true, force: true });
});

describe('health and config pull', () => {
  test('health reports the instance, target and active slots', async () => {
    const h = await get('/app/health');
    expect(h.status).toBe(200);
    expect(h.body).toMatchObject({
      ok: true,
      service: 'app',
      target: { redisUrl: REDIS_URL },
      activeSlots: [],
    });
    expect(String(h.body.instance)).toMatch(/^test-/);
  });

  test('pulls with If-None-Match and gets 304 while nothing changes', async () => {
    await waitFor('several polls', () => engine.configRequests.length >= 4);
    const first = engine.configRequests[0]!;
    expect(first.ifNoneMatch).toBeUndefined();
    expect(first.status).toBe(200);
    const later = engine.configRequests.slice(1);
    expect(later.every((r) => r.ifNoneMatch === `"${engine.etag()}"` && r.status === 304)).toBe(
      true,
    );
    expect((await health()).configEtag).toBe(`"${engine.etag()}"`);
  });
});

describe('slots', () => {
  test('inactive slot serves the baseline: the exact player_stats row, numerics as strings', async () => {
    const r = await get('/app/players/p-001/stats');
    expect(r.status).toBe(200);
    expect(r.headers.get('x-quest-slots')).toBe('cache.getPlayerStats=baseline');
    expect(Object.keys(r.body)).toEqual(STATS_COLUMNS);
    expect(r.body.player_id).toBe('p-001');
    expect(typeof r.body.selected_pct).toBe('string');
  });

  test('unknown player is a 404 with player_not_found', async () => {
    const r = await get('/app/players/p-999/stats');
    expect(r.status).toBe(404);
    expect(r.body).toEqual({ error: 'player_not_found' });
  });

  test('active slot with a missing file falls back to the baseline', async () => {
    await setConfig({ activeSlots: ['cache.getPlayerStats'] });
    const r = await get('/app/players/p-001/stats');
    expect(r.status).toBe(200);
    expect(r.headers.get('x-quest-slots')).toBe('cache.getPlayerStats=baseline-load-error');
    const slots = (await get('/app/slots')).body.slots as Array<{
      name: string;
      state: string;
      error?: { message: string };
    }>;
    const s = slots.find((x) => x.name === 'cache.getPlayerStats')!;
    expect(s.state).toBe('load_error');
    expect(s.error?.message).toMatch(/module not found/);
  });

  test('learner override runs with counted deps once the file appears', async () => {
    installCache('cache-fake.js');
    const r = await waitFor('learner file to be picked up', async () => {
      const x = await get('/app/players/p-028/stats');
      return x.headers.get('x-quest-slots') === 'cache.getPlayerStats=learner' ? x : undefined;
    });
    expect(r.status).toBe(200);
    expect(r.body).toEqual({ player_id: 'p-028', source: 'learner', version: 'v1' });
    expect(await redis.get('test:p07:calls')).not.toBeNull();
    // deps.log lines land in app.log.
    await waitFor('learner log line', () =>
      readFileSync(app.logFile, 'utf8').includes('fake cache called for p-028'),
    );
  });

  test('hot reload: an edited file is used within a couple of poll intervals', async () => {
    const dest = path.join(ws, 'ch2', 'cache.js');
    writeFileSync(
      dest,
      readFileSync(path.join(FIXTURES, 'cache-fake.js'), 'utf8').replace("'v1'", "'v2-edited'"),
    );
    const r = await waitFor(
      'edited version',
      async () => {
        const x = await get('/app/players/p-028/stats');
        return x.body.version === 'v2-edited' ? x : undefined;
      },
      5000,
    );
    expect(r.status).toBe(200);
  });

  test('a learner function that throws gives 500 + x-quest-slot-error, logged, app stays up', async () => {
    installCache('cache-throws.js');
    const r = await waitFor('throwing version', async () => {
      const x = await get('/app/players/p-028/stats');
      return x.status === 500 ? x : undefined;
    });
    expect(r.headers.get('x-quest-slot-error')).toBe('cache exploded for p-028');
    expect(r.body).toMatchObject({
      error: 'slot_error',
      slot: 'cache.getPlayerStats',
      name: 'Error',
      message: 'cache exploded for p-028',
    });
    expect((await get('/app/health')).status).toBe(200);
    expect((await get('/app/players/p-001')).status).toBe(200);
    const log = readFileSync(app.logFile, 'utf8');
    expect(log).toMatch(
      /learner code in slot cache\.getPlayerStats failed: Error: cache exploded for p-028/,
    );
    expect(app.proc.exitCode).toBeNull();
  });

  test('a learner function slower than SLOT_TIMEOUT_MS is cut off the same way', async () => {
    installCache('cache-hangs.js');
    await waitFor('hanging version loaded', async () => {
      const slots = (await get('/app/slots')).body.slots as Array<{ name: string; state: string }>;
      return slots.find((x) => x.name === 'cache.getPlayerStats')?.state === 'loaded';
    });
    await sleep(500);
    const t0 = Date.now();
    const r = await get('/app/players/p-151/stats');
    const ms = Date.now() - t0;
    expect(r.status).toBe(500);
    expect(r.headers.get('x-quest-slot-error')).toMatch(/call exceeded 1000 ms/);
    expect((r.body as { name: string }).name).toBe('TimeoutError');
    expect(ms).toBeGreaterThanOrEqual(900);
    expect(ms).toBeLessThan(3000);
    expect((await get('/app/health')).status).toBe(200);
  });

  test('a file with a syntax error is reported and the baseline serves', async () => {
    // Written here, not kept as a fixture, so the linter never parses it.
    writeFileSync(
      path.join(ws, 'ch2', 'cache.js'),
      'export default async function getPlayerStats( {\n',
    );
    const r = await waitFor('syntax error version', async () => {
      const x = await get('/app/players/p-001/stats');
      return x.headers.get('x-quest-slots') === 'cache.getPlayerStats=baseline-load-error'
        ? x
        : undefined;
    });
    expect(r.status).toBe(200);
    expect(readFileSync(app.logFile, 'utf8')).toMatch(/SyntaxError/);
  });

  test('real cache-aside: second call skips Postgres and uses Redis', async () => {
    installCache('cache-aside.js');
    await waitFor('cache-aside loaded', async () => {
      const slots = (await get('/app/slots')).body.slots as Array<{ name: string; state: string }>;
      return slots.find((x) => x.name === 'cache.getPlayerStats')?.state === 'loaded';
    });
    await sleep(300);
    const first = await get('/app/players/p-028/stats');
    expect(first.status).toBe(200);
    expect(first.headers.get('x-quest-slots')).toBe('cache.getPlayerStats=learner');
    const t0 = performance.now();
    const second = await get('/app/players/p-028/stats');
    const ms = performance.now() - t0;
    expect(second.status).toBe(200);
    expect(second.body.player_id).toBe('p-028');
    expect(ms).toBeLessThan(50);
  });

  test('deactivating returns to the baseline', async () => {
    await setConfig({ activeSlots: [] });
    const r = await get('/app/players/p-028/stats');
    expect(r.headers.get('x-quest-slots')).toBe('cache.getPlayerStats=baseline');
  });
});

describe('metrics push', () => {
  test('pushes one window per second with per-route numbers', async () => {
    const before = engine.pushes.length;
    await get('/app/players/p-001/stats');
    await get('/app/players/p-999/stats');
    const push = await waitFor('a push with the stats route', () =>
      engine.pushes
        .slice(before)
        .find((p) => (p.routes as Record<string, unknown>)['GET /app/players/:id/stats']),
    );
    expect(push.instance).toMatch(/^test-/);
    expect(push.instanceId).toBe(push.instance);
    expect(typeof push.at).toBe('number');
    expect((push.at as number) % 1000).toBe(0);
    expect(push.configEtag).toBe(`"${engine.etag()}"`);
    const route = (push.routes as Record<string, Record<string, number>>)[
      'GET /app/players/:id/stats'
    ]!;
    for (const k of [
      'count',
      'errors',
      'p50Ms',
      'p99Ms',
      'dbQueries',
      'redisCommands',
      'noDbCount',
      'slotErrors',
      'denied',
    ]) {
      expect(typeof route[k]).toBe('number');
    }
    expect(route.count).toBeGreaterThanOrEqual(1);
    expect(route.dbQueries).toBeGreaterThanOrEqual(1);
    // Operational routes are not traffic.
    expect(Object.keys(push.routes as object).some((k) => k.includes('/app/health'))).toBe(false);
  });

  test('learner redis commands and slot errors are counted', async () => {
    const pushes = engine.pushes;
    const all = pushes.flatMap((p) =>
      Object.entries(p.routes as Record<string, Record<string, number>>),
    );
    const stats = all.filter(([k]) => k === 'GET /app/players/:id/stats').map(([, v]) => v);
    expect(stats.reduce((n, s) => n + s.redisCommands, 0)).toBeGreaterThan(0);
    expect(stats.reduce((n, s) => n + s.errors, 0)).toBeGreaterThanOrEqual(2);
    expect(stats.reduce((n, s) => n + s.slotErrors, 0)).toBeGreaterThanOrEqual(2);
    expect(stats.reduce((n, s) => n + s.noDbCount, 0)).toBeGreaterThan(0);
  });

  test('GET /app/metrics shows running totals and the last pushed window', async () => {
    const m = (await get('/app/metrics')).body as {
      totals: Record<string, Record<string, number>>;
      lastWindow: { instance: string };
    };
    const t = m.totals['GET /app/players/:id/stats']!;
    expect(t.count).toBeGreaterThan(5);
    expect(t.redisCommands).toBeGreaterThan(0);
    expect(t.slotErrors).toBeGreaterThanOrEqual(2);
    expect(m.lastWindow.instance).toMatch(/^test-/);
  });

  test('empty seconds are still pushed (instance heartbeat)', async () => {
    const before = engine.pushes.length;
    await waitFor('two more pushes', () => engine.pushes.length >= before + 2, 4000);
  });
});

describe('target switching', () => {
  test('follows the engine target; baselines keep working while Redis is unreachable', async () => {
    await setConfig({ target: { redisUrl: 'redis://127.0.0.1:1' } });
    const h = await health();
    expect(h.target.redisUrl).toBe('redis://127.0.0.1:1');
    expect(h.redis).toBe('down');
    expect((await get('/app/players/p-001')).status).toBe(200);
    await setConfig({ target: { redisUrl: REDIS_URL } });
    await waitFor('redis back up', async () => (await health()).redis === 'up');
  });

  test('extra DB latency from the config is applied to every query', async () => {
    await setConfig({ dbExtraLatencyMs: 300 });
    const t0 = Date.now();
    expect((await get('/app/players/p-001')).status).toBe(200);
    expect(Date.now() - t0).toBeGreaterThanOrEqual(290);
    await setConfig({ dbExtraLatencyMs: 0 });
  });

  test('engine unreachable: the last config is kept', async () => {
    await setConfig({ activeSlots: ['cache.getPlayerStats'] });
    await engine.close();
    await sleep(800);
    const h = await health();
    expect(h.activeSlots).toEqual(['cache.getPlayerStats']);
    expect((await get('/app/health')).body.engine).toBe('down');
  });
});
