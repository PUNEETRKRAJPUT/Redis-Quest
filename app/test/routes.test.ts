import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import path from 'node:path';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { DATABASE_URL, FIXTURES, REDIS_URL, startApp, startStubEngine, tempDir, waitFor, type RunningApp } from './harness.js';

let app: RunningApp;
let ws: string;
let logDir: string;
const NEW_USER = 'u-p07-test';

async function call(p: string, init?: RequestInit) {
  const res = await fetch(`${app.url}${p}`, init);
  const body = (await res.json().catch(() => null)) as Record<string, unknown>;
  return { status: res.status, headers: res.headers, body };
}
const json = (method: string, body: unknown): RequestInit => ({ method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

async function deleteTestUser(): Promise<void> {
  const c = new pg.Client({ connectionString: DATABASE_URL });
  await c.connect();
  await c.query('DELETE FROM users WHERE id = $1', [NEW_USER]);
  await c.end();
}

beforeAll(async () => {
  await deleteTestUser();
  ws = tempDir('ws');
  logDir = tempDir('logs');
  app = await startApp({ workspaceDir: ws, logDir }); // no ENGINE_URL: all baselines
}, 30_000);

afterAll(async () => {
  await app?.stop();
  await deleteTestUser();
  rmSync(ws, { recursive: true, force: true });
  rmSync(logDir, { recursive: true, force: true });
});

describe('baseline routes (no engine configured)', () => {
  test('GET /app/players/:id', async () => {
    const r = await call('/app/players/p-028');
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ id: 'p-028', team_id: 't-02' });
    expect((await call('/app/players/p-999')).status).toBe(404);
  });

  test('POST /app/players/:id/stats/refresh', async () => {
    const r = await call('/app/players/p-028/stats/refresh', { method: 'POST' });
    expect(r.status).toBe(200);
    expect(r.body).toEqual({ ok: true, playerId: 'p-028', result: { touched: 1 } });
    expect(r.headers.get('x-quest-slots')).toBe('cache.invalidatePlayerStats=baseline');
  });

  test('GET /app/fixtures lists scheduled and live matches', async () => {
    const r = await call('/app/fixtures');
    const fixtures = r.body.fixtures as Array<{ id: string; status: string }>;
    expect(r.status).toBe(200);
    expect(fixtures.map((f) => f.id)).toEqual(expect.arrayContaining(['m-041', 'm-042', 'm-043']));
    expect(fixtures.every((f) => f.status === 'scheduled' || f.status === 'live')).toBe(true);
    expect(fixtures.some((f) => f.id === 'm-001')).toBe(false);
  });

  test('POST /app/login then GET /app/me with the sid cookie', async () => {
    const login = await call('/app/login', json('POST', { userId: 'u-000010' }));
    expect(login.status).toBe(200);
    const cookie = login.headers.get('set-cookie') ?? '';
    expect(cookie).toMatch(/^sid=[0-9a-f]{32}; Path=\/app; HttpOnly/);
    const me = await call('/app/me', { headers: { cookie: cookie.split(';')[0]! } });
    expect(me.status).toBe(200);
    expect(me.body.userId).toBe('u-000010');
    expect((await call('/app/me')).status).toBe(401);
    expect((await call('/app/me', { headers: { cookie: 'sid=nope' } })).status).toBe(401);
    expect((await call('/app/login', json('POST', { userId: 'u-999999' }))).status).toBe(404);
  });

  test('GET /app/leaderboard/:contestId orders by points', async () => {
    const r = await call('/app/leaderboard/1?limit=5');
    const entries = r.body.entries as Array<{ rank: number; points: number; userId: string }>;
    expect(r.status).toBe(200);
    expect(entries).toHaveLength(5);
    expect(entries.map((e) => e.rank)).toEqual([1, 2, 3, 4, 5]);
    for (let i = 1; i < entries.length; i++) expect(entries[i - 1]!.points).toBeGreaterThanOrEqual(entries[i]!.points);
    expect(((await call('/app/leaderboard/62')).body.entries as unknown[]).length).toBe(10);
    expect((await call('/app/leaderboard/abc')).status).toBe(400);
  });

  test('GET /app/limits/ping: fixed window per x-user-id', async () => {
    const statuses: number[] = [];
    for (let i = 0; i < 12; i++) statuses.push((await call('/app/limits/ping', { headers: { 'x-user-id': 'u-000001' } })).status);
    expect(statuses.filter((s) => s === 200)).toHaveLength(10);
    expect(statuses.slice(10)).toEqual([429, 429]);
    expect((await call('/app/limits/ping', { headers: { 'x-user-id': 'u-000002' } })).status).toBe(200);
    expect((await call('/app/limits/ping')).status).toBe(400);
  });

  test('POST /app/register inserts into Postgres only', async () => {
    const user = { id: NEW_USER, name: 'Test Student', college_id: 'c-02', hostel_id: 'h-c-02-1' };
    const r = await call('/app/register', json('POST', user));
    expect(r.status).toBe(201);
    expect(r.body).toMatchObject({ ok: true, id: NEW_USER });
    expect((await call('/app/register', json('POST', user))).status).toBe(409);
    expect((await call('/app/register', json('POST', { ...user, id: 'u-p07-other', college_id: 'c-99' }))).status).toBe(400);
    expect((await call('/app/register', json('POST', { id: 'x' }))).status).toBe(400);
  });

  test('engine not configured is visible in health', async () => {
    expect((await call('/app/health')).body).toMatchObject({ engine: 'unconfigured', activeSlots: [], configEtag: null });
  });
});

describe('synchronous infinite loop in learner code', () => {
  test('cannot be interrupted in-process, but the watchdog reports it in app.log', async () => {
    const ws2 = tempDir('ws-spin');
    const logs2 = tempDir('logs-spin');
    mkdirSync(path.join(ws2, 'ch2'), { recursive: true });
    copyFileSync(path.join(FIXTURES, 'cache-spins.js'), path.join(ws2, 'ch2', 'cache.js'));
    const engine = await startStubEngine({ target: { redisUrl: REDIS_URL }, activeSlots: ['cache.getPlayerStats'], dbExtraLatencyMs: 0 });
    const spin = await startApp({ engineUrl: engine.url, workspaceDir: ws2, logDir: logs2, env: { SLOT_TIMEOUT_MS: '500' } });
    try {
      await waitFor('slot loaded', async () => {
        const s = (await (await fetch(`${spin.url}/app/slots`)).json()) as { slots: Array<{ name: string; state: string }> };
        return s.slots.find((x) => x.name === 'cache.getPlayerStats')?.state === 'loaded';
      });
      void fetch(`${spin.url}/app/players/p-028/stats`, { signal: AbortSignal.timeout(3000) }).catch(() => undefined);
      const line = await waitFor('watchdog line', () => {
        const file = path.join(logs2, 'app', 'app.log');
        const text = existsSync(file) ? readFileSync(file, 'utf8') : '';
        return text.split('\n').find((l) => l.includes('event loop blocked'));
      }, 5000);
      expect(JSON.parse(line)).toMatchObject({ level: 50, suspectSlot: 'cache.getPlayerStats', instance: expect.stringMatching(/^test-/) });
    } finally {
      await spin.stop();
      await engine.close();
      rmSync(ws2, { recursive: true, force: true });
      rmSync(logs2, { recursive: true, force: true });
    }
  }, 20_000);
});
