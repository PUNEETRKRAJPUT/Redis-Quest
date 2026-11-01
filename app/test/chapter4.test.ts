import { copyFileSync, mkdirSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import pg from 'pg';
import { createClient } from 'redis';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { routeKey } from '../src/workers/ops.js';
import {
  DATABASE_URL,
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

// Chapter 4 app surface (A-03): stream workers, the job queue, idempotent credit, the contest lock, TTL jitter,
// the Bloom username check and the ops wall with the provided request hook. Runs the built app against the
// quest-a03 redis and postgres (see harness.ts); redis:8 has the Bloom, TimeSeries and t-digest modules.

let engine: StubEngine;
let app: RunningApp;
let ws: string;
let logDir: string;
const redis = createClient({ url: REDIS_URL });
const db = new pg.Client({ connectionString: DATABASE_URL });
const USER = 'u-020000';
let walletBalance = 0;
let ledgerFloor = 0;

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

function install(fixture: string, target: string): void {
  mkdirSync(path.join(ws, 'ch4'), { recursive: true });
  const dest = path.join(ws, 'ch4', target);
  copyFileSync(path.join(FIXTURES, fixture), dest);
  const t = new Date(Date.now() + Math.floor(Math.random() * 1000));
  utimesSync(dest, t, t);
}

const QUEUE_KEYS = [
  'queue:jobs:pending',
  'queue:jobs:processing',
  'queue:jobs:completed',
  'queue:jobs:failed',
  'queue:jobs:delayed',
];
async function cleanQueue(): Promise<void> {
  const ids = await redis.keys('queue:jobs:job:*');
  await redis.del([...QUEUE_KEYS, ...ids]);
}
async function stats(): Promise<Record<string, number>> {
  return (await call('/app/jobs/stats')).body as Record<string, number>;
}

const OPS_ROUTE = 'GET /app/players/:id';
const OPS_KEYS = ['requests', 'errors', 'latency'].map((k) => `ts:${k}:${routeKey(OPS_ROUTE)}`);
const A03_KEYS = [
  'match:m-a03:balls',
  'match:m-a03:balls:dead',
  'lb:match:m-a03',
  'contest:9003:slots',
  'contest:9003:members',
  'lock:contest:9003',
  'wallet:u-a03-test',
  'idem:a03-key-1',
  'idem:a03-key-2',
  'bf:usernames',
  'td:latency',
  ...OPS_KEYS,
  'ts:requests:GET_a03_route',
  'ts:errors:GET_a03_route',
  'ts:latency:GET_a03_route',
];

beforeAll(async () => {
  await redis.connect();
  await db.connect();
  const bal = await db.query('SELECT balance FROM wallets WHERE user_id = $1', [USER]);
  walletBalance = bal.rows[0].balance as number;
  const max = await db.query('SELECT coalesce(max(id), 0) AS m FROM wallet_transactions');
  ledgerFloor = Number(max.rows[0].m);
  await cleanQueue();
  await redis.del(A03_KEYS);
  ws = tempDir('ws-ch4');
  logDir = tempDir('logs-ch4');
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
  await db.query('UPDATE wallets SET balance = $2 WHERE user_id = $1', [USER, walletBalance]);
  await db.query('DELETE FROM wallet_transactions WHERE id > $1 AND user_id = $2', [
    ledgerFloor,
    USER,
  ]);
  await cleanQueue();
  await redis.del([
    ...A03_KEYS,
    ...(await redis.keys('storm:a03:*')),
    ...(await redis.keys('score:a03:*')),
  ]);
  await db.end();
  await redis.close();
  rmSync(ws, { recursive: true, force: true });
  rmSync(logDir, { recursive: true, force: true });
});

describe('registry rows and the route key rule', () => {
  test('the fifteen Chapter 4 slots declare the contracted file and signature', async () => {
    const { SLOTS } = await import('../src/slots/registry.js');
    const want: Array<[string, string, string]> = [
      ['points.consume', 'ch4/points-consume.js', '(deps, matchId, consumer, count)'],
      [
        'points.sweep',
        'ch4/points-sweep.js',
        '(deps, matchId, consumer, minIdleMs, maxDeliveries)',
      ],
      ['jobs.enqueue', 'ch4/jobs-enqueue.js', '(deps, payload)'],
      ['jobs.claim', 'ch4/jobs-claim.js', '(deps, worker, timeoutMs)'],
      ['jobs.complete', 'ch4/jobs-complete.js', '(deps, id, token, result)'],
      ['jobs.fail', 'ch4/jobs-fail.js', '(deps, id, token, error, maxAttempts)'],
      ['jobs.reclaim', 'ch4/jobs-reclaim.js', '(deps, visibilityMs)'],
      ['jobs.schedule', 'ch4/jobs-schedule.js', '(deps, payload, runAtMs)'],
      ['jobs.promoteDue', 'ch4/jobs-promote.js', '(deps, nowMs)'],
      ['wallet.credit', 'ch4/wallet-credit.js', '(deps, userId, amount, idempotencyKey)'],
      ['contest.claimLastSlot', 'ch4/contest-last-slot.js', '(deps, contestId, userId)'],
      [
        'sessions.expireWithJitter',
        'ch4/sessions-jitter.js',
        '(deps, keys, baseSeconds, jitterSeconds)',
      ],
      ['users.usernameTaken', 'ch4/username-taken.js', '(deps, name)'],
      ['ops.record', 'ch4/ops-record.js', '(deps, sample)'],
      ['ops.range', 'ch4/ops-range.js', '(deps, route, fromMs, toMs, bucketMs)'],
    ];
    for (const [name, file, signature] of want) {
      expect(
        SLOTS.find((s) => s.name === name),
        name,
      ).toMatchObject({ file, signature });
    }
  });

  test('routeKey collapses runs of spaces and slashes into one underscore, and is idempotent', () => {
    expect(routeKey('GET /app/players/:id/stats')).toBe('GET_app_players_:id_stats');
    expect(routeKey('POST /app/jobs/:id/complete')).toBe('POST_app_jobs_:id_complete');
    expect(routeKey('GET_app_players_:id_stats')).toBe('GET_app_players_:id_stats');
  });
});

describe('baseline routes (no slot active)', () => {
  test('points.consume reads Postgres and processes nothing; sweep finds nothing', async () => {
    const r = await post('/app/workers/points/consume', {
      matchId: 'm-001',
      consumer: 'w1',
      count: 5,
    });
    expect(r.status).toBe(200);
    expect(r.body).toEqual({ ok: true, result: { processed: [] } });
    expect(r.headers.get('x-quest-slots')).toBe('points.consume=baseline');
    const m = await call('/app/metrics');
    expect(m.body.totals['POST /app/workers/points/consume'].dbQueries).toBe(1);
    const s = await post('/app/workers/points/sweep', { matchId: 'm-001', consumer: 'w1' });
    expect(s.body).toEqual({ ok: true, result: { reclaimed: [], deadLettered: [] } });
    expect(await redis.exists('match:m-001:balls')).toBe(0); // nothing was added to Redis
  });

  test('consume and sweep validation', async () => {
    const c = '/app/workers/points/consume';
    expect((await post(c, { consumer: 'w1' })).body.error).toBe('invalid_match_id');
    expect((await post(c, { matchId: 'm-001' })).body.error).toBe('invalid_consumer');
    expect((await post(c, { matchId: 'm-001', consumer: 'w1', count: 0 })).body.error).toBe(
      'invalid_count',
    );
    expect((await post(c, { matchId: 'm-001', consumer: 'w1', count: 101 })).status).toBe(400);
    expect((await post(c, { matchId: 'm-001', consumer: 'w1', count: 1.5 })).status).toBe(400);
    const s = '/app/workers/points/sweep';
    expect((await post(s, { consumer: 'w1' })).status).toBe(400);
    expect((await post(s, { matchId: 'm', consumer: 'w', minIdleMs: -1 })).body.error).toBe(
      'invalid_min_idle',
    );
    expect((await post(s, { matchId: 'm', consumer: 'w', maxDeliveries: 0 })).body.error).toBe(
      'invalid_max_deliveries',
    );
  });

  test('the in-memory queue round trip: enqueue, claim, complete; a stale token is 409', async () => {
    const enq = await post('/app/jobs', { payload: { kind: 'payout', amount: 50 } });
    expect(enq.status).toBe(201);
    expect(enq.body.id).toMatch(/^[0-9a-f]{16}$/);
    expect(enq.headers.get('x-quest-slots')).toBe('jobs.enqueue=baseline');
    const claim = await post('/app/jobs/claim', { worker: 'w1', timeoutMs: 200 });
    expect(claim.body.job).toMatchObject({
      id: enq.body.id,
      payload: { kind: 'payout', amount: 50 },
      attempts: 1,
    });
    const token = claim.body.job.token as string;
    expect((await post(`/app/jobs/${enq.body.id}/complete`, { token: 'nope' })).status).toBe(409);
    expect((await post(`/app/jobs/${enq.body.id}/complete`, { token })).body).toEqual({ ok: true });
    expect((await post(`/app/jobs/${enq.body.id}/complete`, { token })).body.error).toBe(
      'not_owner',
    );
    const empty = await post('/app/jobs/claim', { worker: 'w1', timeoutMs: 100 });
    expect(empty.body).toEqual({ job: null });
  });

  test('in-memory fail: retry until maxAttempts, then failed; stats shows inMemory only', async () => {
    const { body } = await post('/app/jobs', { payload: 1 });
    const t1 = (await post('/app/jobs/claim', { worker: 'w1', timeoutMs: 200 })).body.job.token;
    const f1 = await post(`/app/jobs/${body.id}/fail`, {
      token: t1,
      error: 'boom',
      maxAttempts: 2,
    });
    expect(f1.body).toEqual({ outcome: 'retry' });
    const c2 = (await post('/app/jobs/claim', { worker: 'w1', timeoutMs: 200 })).body.job;
    expect(c2.attempts).toBe(2);
    const f2 = await post(`/app/jobs/${body.id}/fail`, {
      token: c2.token,
      error: 'boom',
      maxAttempts: 2,
    });
    expect(f2.body).toEqual({ outcome: 'failed' });
    const st = await stats();
    expect(st).toMatchObject({ pending: 0, processing: 0, completed: 0, failed: 0, delayed: 0 });
    expect((st as unknown as { inMemory: Record<string, number> }).inMemory.failed).toBeGreaterThan(
      0,
    );
    expect((await post('/app/jobs/reclaim', {})).body).toEqual({ reclaimed: 0 });
    expect((await post('/app/jobs/promote', {})).body).toEqual({ promoted: 0 });
  });

  test('in-memory schedule: the timer fires in this process, promote does nothing', async () => {
    const r = await post('/app/jobs/schedule', { payload: 'later', runAtMs: Date.now() + 50 });
    expect(r.status).toBe(201);
    await sleep(150);
    const c = await post('/app/jobs/claim', { worker: 'w1', timeoutMs: 100 });
    expect(c.body.job).toMatchObject({ id: r.body.id, payload: 'later' });
  });

  test('job route validation', async () => {
    expect((await post('/app/jobs', {})).body.error).toBe('invalid_payload');
    expect((await post('/app/jobs', { payload: 'x'.repeat(5000) })).body.error).toBe(
      'payload_too_large',
    );
    expect((await post('/app/jobs', { payload: null })).status).toBe(201); // null is JSON too
    expect((await post('/app/jobs/claim', {})).body.error).toBe('invalid_worker');
    expect((await post('/app/jobs/claim', { worker: 'w', timeoutMs: 5001 })).status).toBe(400);
    expect((await post('/app/jobs/abc/complete', {})).body.error).toBe('invalid_token');
    expect((await post('/app/jobs/abc/fail', { token: 't' })).body.error).toBe('invalid_error');
    expect(
      (await post('/app/jobs/abc/fail', { token: 't', error: 'e', maxAttempts: 0 })).status,
    ).toBe(400);
    expect((await post('/app/jobs/reclaim', { visibilityMs: -1 })).status).toBe(400);
    expect((await post('/app/jobs/schedule', { payload: 1 })).body.error).toBe('invalid_run_at');
    expect((await post('/app/jobs/promote', { nowMs: 'x' })).status).toBe(400);
  });

  test('GET /app/jobs/stats reads the queue keys itself', async () => {
    await cleanQueue();
    await redis.lPush('queue:jobs:pending', ['a', 'b']);
    await redis.lPush('queue:jobs:processing', 'c');
    await redis.zAdd('queue:jobs:delayed', { score: 1, value: 'd' });
    const st = await stats();
    expect(st).toMatchObject({ pending: 2, processing: 1, completed: 0, failed: 0, delayed: 1 });
    expect(st.inMemory).toBeDefined();
    await cleanQueue();
  });

  test('wallet.credit: the same key credits twice and writes two ledger rows (the bug)', async () => {
    const a = await post(`/app/wallets/${USER}/credit`, { amount: 7, key: 'a03-key-1' });
    const b = await post(`/app/wallets/${USER}/credit`, { amount: 7, key: 'a03-key-1' });
    expect(a.body).toEqual({ credited: true, balance: walletBalance + 7 });
    expect(b.body).toEqual({ credited: true, balance: walletBalance + 14 });
    expect(a.headers.get('x-quest-slots')).toBe('wallet.credit=baseline');
    const led = await db.query(
      'SELECT delta, reason, ref FROM wallet_transactions WHERE id > $1 AND user_id = $2 ORDER BY id',
      [ledgerFloor, USER],
    );
    expect(led.rows).toEqual([
      { delta: 7, reason: 'contest_payout', ref: 'a03-key-1' },
      { delta: 7, reason: 'contest_payout', ref: 'a03-key-1' },
    ]);
    // an unknown user has no wallet row: nothing credited
    const ghost = await post('/app/wallets/u-nobody/credit', { amount: 5, key: 'k' });
    expect(ghost.body).toEqual({ credited: false, balance: 0 });
    await db.query('UPDATE wallets SET balance = $2 WHERE user_id = $1', [USER, walletBalance]);
  });

  test('wallet credit validation', async () => {
    const p = `/app/wallets/${USER}/credit`;
    expect((await post(p, { amount: 0, key: 'k' })).body.error).toBe('invalid_amount');
    expect((await post(p, { amount: 100_001, key: 'k' })).status).toBe(400);
    expect((await post(p, { amount: 1.5, key: 'k' })).status).toBe(400);
    expect((await post(p, { amount: 5 })).body.error).toBe('invalid_key');
    expect((await post(p, { amount: 5, key: 'k'.repeat(65) })).status).toBe(400);
  });

  test('last-slot baseline: check then act, a counter at 1 and one caller is fine', async () => {
    await redis.set('contest:9003:slots', '1');
    const first = await post('/app/contests/9003/last-slot', { userId: 'u-1' });
    expect(first.status).toBe(200);
    expect(first.body).toEqual({ got: true });
    const second = await post('/app/contests/9003/last-slot', { userId: 'u-2' });
    expect(second.status).toBe(409);
    expect(second.body).toEqual({ error: 'contest_full' });
    expect(await redis.get('contest:9003:slots')).toBe('0');
    expect((await post('/app/contests/9003/last-slot', {})).body.error).toBe('invalid_user_id');
    expect((await post('/app/contests/0/last-slot', { userId: 'u' })).status).toBe(400);
    // no counter at all: nothing to give
    await redis.del('contest:9003:slots');
    expect((await post('/app/contests/9003/last-slot', { userId: 'u-3' })).status).toBe(409);
  });

  test('expire-batch baseline gives every key the same TTL; game:* is refused', async () => {
    const keys = Array.from({ length: 20 }, (_, i) => `storm:a03:${i}`);
    await redis.mSet(keys.flatMap((k) => [k, 'x']));
    const r = await post('/app/ops/expire-batch', { keys, baseSeconds: 600, jitterSeconds: 120 });
    expect(r.body).toEqual({ expired: 20 });
    expect(r.headers.get('x-quest-slots')).toBe('sessions.expireWithJitter=baseline');
    const ttls = await Promise.all(keys.map((k) => redis.ttl(k)));
    expect(new Set(ttls).size).toBeLessThanOrEqual(2); // the loop spans at most a second boundary
    expect(Math.min(...ttls)).toBeGreaterThanOrEqual(599);
    expect(Math.max(...ttls)).toBeLessThanOrEqual(600);
    // keys that do not exist are not counted
    const miss = await post('/app/ops/expire-batch', {
      keys: ['storm:a03:nope'],
      baseSeconds: 10,
      jitterSeconds: 0,
    });
    expect(miss.body).toEqual({ expired: 0 });
    const e = '/app/ops/expire-batch';
    expect((await post(e, { keys: [], baseSeconds: 1, jitterSeconds: 0 })).body.error).toBe(
      'invalid_keys',
    );
    expect((await post(e, { keys: ['game:x'], baseSeconds: 1, jitterSeconds: 0 })).body.error).toBe(
      'reserved_key',
    );
    expect((await post(e, { keys: [1], baseSeconds: 1, jitterSeconds: 0 })).status).toBe(400);
    expect((await post(e, { keys: ['a'], baseSeconds: 0, jitterSeconds: 0 })).body.error).toBe(
      'invalid_base',
    );
    expect((await post(e, { keys: ['a'], baseSeconds: 1, jitterSeconds: 3601 })).body.error).toBe(
      'invalid_jitter',
    );
    const many = Array.from({ length: 5001 }, (_, i) => `k${i}`);
    expect((await post(e, { keys: many, baseSeconds: 1, jitterSeconds: 0 })).status).toBe(400);
  });

  test('username check baseline always asks Postgres', async () => {
    const handle = (await db.query("SELECT handle FROM users WHERE id = 'u-000010'")).rows[0]
      .handle as string;
    const known = await call(`/app/usernames/${encodeURIComponent(handle)}`);
    expect(known.body).toEqual({ name: handle, taken: true, checkedDb: true });
    expect(known.headers.get('x-quest-slots')).toBe('users.usernameTaken=baseline');
    const unknown = await call('/app/usernames/nobody.has.this.name');
    expect(unknown.body).toEqual({ name: 'nobody.has.this.name', taken: false, checkedDb: true });
    expect((await call(`/app/usernames/${'x'.repeat(65)}`)).status).toBe(400);
  });

  test('ops routes answer, and the baseline wall is empty', async () => {
    const r = await post('/app/ops/samples', {
      route: 'GET /x',
      status: 200,
      ms: 12.5,
      at: Date.now(),
    });
    expect(r.body).toEqual({ ok: true });
    const w = await call(`/app/ops/wall?route=${encodeURIComponent('GET /x')}`);
    expect(w.status).toBe(200);
    expect(w.body).toEqual({ route: 'GET /x', buckets: [] });
    const s = '/app/ops/samples';
    expect((await post(s, { status: 200, ms: 1 })).body.error).toBe('invalid_route');
    expect((await post(s, { route: 'r', status: 99, ms: 1 })).body.error).toBe('invalid_status');
    expect((await post(s, { route: 'r', status: 200, ms: -1 })).body.error).toBe('invalid_ms');
    expect((await post(s, { route: 'r', status: 200, ms: 1, at: 1.5 })).body.error).toBe(
      'invalid_at',
    );
    expect((await call('/app/ops/wall')).body.error).toBe('invalid_route');
    expect((await call('/app/ops/wall?route=r&bucket=10')).body.error).toBe('invalid_bucket');
    expect((await call('/app/ops/wall?route=r&from=10&to=5')).body.error).toBe('invalid_from');
    expect((await call('/app/ops/wall?route=r&from=0&to=100000000&bucket=1000')).body.error).toBe(
      'too_many_buckets',
    );
  });
});

describe('learner path with the reference fixtures', () => {
  test('consume as w1 then w2: every ball once, nothing pending; a lost read is swept; a poison ball is dead-lettered', async () => {
    install('points-consume.js', 'points-consume.js');
    install('points-sweep.js', 'points-sweep.js');
    await setConfig(['points.consume', 'points.sweep']);
    const stream = 'match:m-a03:balls';
    const ids = Array.from({ length: 6 }, (_, i) => `170000000000${i + 1}-0`);
    await redis.del([stream, `${stream}:dead`, 'lb:match:m-a03']);
    for (const [i, id] of ids.entries())
      await redis.xAdd(stream, id, {
        over: '1',
        ball: String(i + 1),
        batter: 'p-028',
        runs: String(i + 1),
      });

    const w1 = await post('/app/workers/points/consume', {
      matchId: 'm-a03',
      consumer: 'w1',
      count: 3,
    });
    expect(w1.body.result.processed).toEqual(ids.slice(0, 3));
    expect(w1.headers.get('x-quest-slots')).toBe('points.consume=learner');
    const w2 = await post('/app/workers/points/consume', {
      matchId: 'm-a03',
      consumer: 'w2',
      count: 3,
    });
    expect(w2.body.result.processed).toEqual(ids.slice(3));
    expect((await redis.xPending(stream, 'points')).pending).toBe(0);
    expect(await redis.zScore('lb:match:m-a03', 'p-028')).toBe(21);
    const none = await post('/app/workers/points/consume', { matchId: 'm-a03', consumer: 'w1' });
    expect(none.body.result.processed).toEqual([]);

    // w2 reads three more without acking (it "died"), the sweep by w1 takes them over
    const more = ['1700000000007-0', '1700000000008-0', '1700000000009-0'];
    for (const id of more)
      await redis.xAdd(stream, id, { over: '2', ball: '1', batter: 'p-028', runs: '1' });
    await redis.xReadGroup('points', 'w2', { key: stream, id: '>' }, { COUNT: 3 });
    expect((await redis.xPending(stream, 'points')).pending).toBe(3);
    const sw = await post('/app/workers/points/sweep', {
      matchId: 'm-a03',
      consumer: 'w1',
      minIdleMs: 0,
    });
    expect(sw.body.result).toEqual({ reclaimed: more, deadLettered: [] });
    expect((await redis.xPending(stream, 'points')).pending).toBe(0);

    // a poison ball: delivered, then claimed four more times (delivery counter 5), then swept
    const poison = '1700000000010-0';
    await redis.xAdd(stream, poison, { over: '2', ball: '2', batter: 'p-028', runs: 'x' });
    await redis.xReadGroup('points', 'w2', { key: stream, id: '>' }, { COUNT: 1 });
    for (let i = 0; i < 4; i++) await redis.xClaim(stream, 'points', 'w2', 0, poison);
    const pr = await post('/app/workers/points/sweep', {
      matchId: 'm-a03',
      consumer: 'w1',
      minIdleMs: 0,
      maxDeliveries: 5,
    });
    expect(pr.body.result).toEqual({ reclaimed: [], deadLettered: [poison] });
    expect((await redis.xPending(stream, 'points')).pending).toBe(0);
    const dead = await redis.xRange(`${stream}:dead`, '-', '+');
    expect(dead).toHaveLength(1);
    expect(dead[0].message).toMatchObject({ reason: 'max-deliveries', original_id: poison });
  });

  test('the job queue: 20 jobs, two workers claiming in parallel, fencing, reclaim, delayed jobs', async () => {
    for (const f of ['jobs-enqueue', 'jobs-claim', 'jobs-complete', 'jobs-fail', 'jobs-reclaim'])
      install(`${f}.js`, `${f}.js`);
    install('jobs-schedule.js', 'jobs-schedule.js');
    install('jobs-promote.js', 'jobs-promote.js');
    await setConfig([
      'jobs.enqueue',
      'jobs.claim',
      'jobs.complete',
      'jobs.fail',
      'jobs.reclaim',
      'jobs.schedule',
      'jobs.promoteDue',
    ]);
    await cleanQueue();
    const enq = await Promise.all(
      Array.from({ length: 20 }, (_, i) => post('/app/jobs', { payload: { n: i } })),
    );
    expect(enq.every((r) => r.status === 201)).toBe(true);
    expect(enq[0].headers.get('x-quest-slots')).toBe('jobs.enqueue=learner');
    expect(await stats()).toMatchObject({ pending: 20, processing: 0 });

    const worker = async (w: string) => {
      const got: Array<{ id: string; token: string; payload: { n: number } }> = [];
      for (;;) {
        const r = await post('/app/jobs/claim', { worker: w, timeoutMs: 300 });
        if (r.body.job === null) return got;
        got.push(r.body.job);
      }
    };
    const [a, b] = await Promise.all([worker('w1'), worker('w2')]);
    const all = [...a, ...b];
    expect(new Set(all.map((j) => j.id)).size).toBe(20);
    expect(a.length).toBeGreaterThan(0);
    expect(b.length).toBeGreaterThan(0);
    expect(await stats()).toMatchObject({ pending: 0, processing: 20 });
    const h = await redis.hGetAll(`queue:jobs:job:${all[0].id}`);
    expect(h).toMatchObject({ status: 'processing', attempts: '1', claim_token: all[0].token });

    // fencing: a stale token cannot complete, the right one can once
    expect((await post(`/app/jobs/${all[0].id}/complete`, { token: 'stale' })).body).toEqual({
      error: 'not_owner',
    });
    for (const j of all)
      expect((await post(`/app/jobs/${j.id}/complete`, { token: j.token, result: 1 })).status).toBe(
        200,
      );
    expect((await post(`/app/jobs/${all[0].id}/complete`, { token: all[0].token })).status).toBe(
      409,
    );
    expect(await stats()).toMatchObject({ pending: 0, processing: 0, completed: 20, failed: 0 });
    expect(await redis.hGet(`queue:jobs:job:${all[0].id}`, 'status')).toBe('completed');

    // fail: retry then failed
    const one = (await post('/app/jobs', { payload: 'f' })).body.id as string;
    const c1 = (await post('/app/jobs/claim', { worker: 'w1', timeoutMs: 300 })).body.job;
    expect(
      (await post(`/app/jobs/${one}/fail`, { token: c1.token, error: 'x', maxAttempts: 2 })).body,
    ).toEqual({ outcome: 'retry' });
    expect(
      (await post(`/app/jobs/${one}/fail`, { token: c1.token, error: 'x', maxAttempts: 2 })).status,
    ).toBe(409); // the old claim is dead
    const c2 = (await post('/app/jobs/claim', { worker: 'w1', timeoutMs: 300 })).body.job;
    expect(c2.attempts).toBe(2);
    expect(
      (await post(`/app/jobs/${one}/fail`, { token: c2.token, error: 'x', maxAttempts: 2 })).body,
    ).toEqual({ outcome: 'failed' });
    expect(await stats()).toMatchObject({ failed: 1, pending: 0, processing: 0 });

    // reclaim: a job whose claim is old goes back, a fresh claim stays
    const lost = (await post('/app/jobs', { payload: 'lost' })).body.id as string;
    const fresh = (await post('/app/jobs/claim', { worker: 'w9', timeoutMs: 300 })).body.job;
    expect(fresh.id).toBe(lost);
    expect((await post('/app/jobs/reclaim', { visibilityMs: 5000 })).body).toEqual({
      reclaimed: 0,
    });
    await redis.hSet(`queue:jobs:job:${lost}`, 'claimed_at_ms', String(Date.now() - 60_000));
    expect((await post('/app/jobs/reclaim', { visibilityMs: 5000 })).body).toEqual({
      reclaimed: 1,
    });
    expect(await stats()).toMatchObject({ pending: 1, processing: 0 });
    // the worker that lost it can no longer complete it
    expect((await post(`/app/jobs/${lost}/complete`, { token: fresh.token })).status).toBe(409);
    const again = (await post('/app/jobs/claim', { worker: 'w2', timeoutMs: 300 })).body.job;
    expect(again).toMatchObject({ id: lost, attempts: 2 });
    await post(`/app/jobs/${lost}/complete`, { token: again.token });

    // delayed: one far in the future, one in the past
    const past = await post('/app/jobs/schedule', { payload: 'past', runAtMs: 1 });
    const future = await post('/app/jobs/schedule', {
      payload: 'future',
      runAtMs: 9_999_999_999_999,
    });
    expect(past.status).toBe(201);
    expect(await stats()).toMatchObject({ delayed: 2, pending: 0 });
    expect((await post('/app/jobs/promote', { nowMs: Date.now() })).body).toEqual({ promoted: 1 });
    expect(await stats()).toMatchObject({ delayed: 1, pending: 1 });
    const due = (await post('/app/jobs/claim', { worker: 'w1', timeoutMs: 300 })).body.job;
    expect(due).toMatchObject({ id: past.body.id, payload: 'past' });
    expect(await redis.zScore('queue:jobs:delayed', future.body.id)).toBe(9_999_999_999_999);
    // an empty queue: claim waits out its timeout and answers null (BLMOVE on a duplicate, not the shared client)
    await post(`/app/jobs/${due.id}/complete`, { token: due.token });
    const t0 = Date.now();
    const empty = await post('/app/jobs/claim', { worker: 'w1', timeoutMs: 700 });
    expect(empty.body).toEqual({ job: null });
    expect(Date.now() - t0).toBeGreaterThanOrEqual(650);
  }, 60_000);

  test('wallet.credit: one key credits once, even 20 at a time; the key expires', async () => {
    install('wallet-credit.js', 'wallet-credit.js');
    await setConfig(['wallet.credit']);
    await redis.set('wallet:u-a03-test', '100');
    const a = await post('/app/wallets/u-a03-test/credit', { amount: 50, key: 'a03-key-1' });
    const b = await post('/app/wallets/u-a03-test/credit', { amount: 50, key: 'a03-key-1' });
    expect(a.body).toEqual({ credited: true, balance: 150 });
    expect(b.body).toEqual({ credited: false, balance: 150 });
    expect(a.headers.get('x-quest-slots')).toBe('wallet.credit=learner');
    const ttl = await redis.ttl('idem:a03-key-1');
    expect(ttl).toBeGreaterThan(0);
    expect(ttl).toBeLessThanOrEqual(86_400);
    const par = await Promise.all(
      Array.from({ length: 20 }, () =>
        post('/app/wallets/u-a03-test/credit', { amount: 10, key: 'a03-key-2' }),
      ),
    );
    expect(par.filter((r) => r.body.credited === true)).toHaveLength(1);
    expect(await redis.get('wallet:u-a03-test')).toBe('160');
  });

  test('contest.claimLastSlot: 50 parallel requests for one slot, exactly one wins, lock released', async () => {
    install('contest-last-slot.js', 'contest-last-slot.js');
    await setConfig(['contest.claimLastSlot']);
    await redis.del(['contest:9003:members', 'lock:contest:9003']);
    await redis.set('contest:9003:slots', '1');
    const rs = await Promise.all(
      Array.from({ length: 50 }, (_, i) =>
        post('/app/contests/9003/last-slot', { userId: `u-${i}` }),
      ),
    );
    expect(rs.filter((r) => r.status === 200)).toHaveLength(1);
    expect(rs.filter((r) => r.status === 409)).toHaveLength(49);
    expect(await redis.get('contest:9003:slots')).toBe('0');
    expect(await redis.sCard('contest:9003:members')).toBe(1);
    expect(await redis.exists('lock:contest:9003')).toBe(0);
    expect(rs[0].headers.get('x-quest-slots')).toBe('contest.claimLastSlot=learner');
  }, 30_000);

  test('sessions.expireWithJitter spreads the TTLs over the jitter window', async () => {
    install('sessions-jitter.js', 'sessions-jitter.js');
    await setConfig(['sessions.expireWithJitter']);
    const keys = Array.from({ length: 200 }, (_, i) => `storm:a03:${i}`);
    await redis.mSet(keys.flatMap((k) => [k, 'x']));
    const r = await post('/app/ops/expire-batch', { keys, baseSeconds: 600, jitterSeconds: 60 });
    expect(r.body).toEqual({ expired: 200 });
    const ttls = await Promise.all(keys.map((k) => redis.ttl(k)));
    expect(Math.min(...ttls)).toBeGreaterThanOrEqual(599);
    expect(Math.max(...ttls)).toBeLessThanOrEqual(660);
    expect(Math.max(...ttls) - Math.min(...ttls)).toBeGreaterThanOrEqual(30);
  });

  test('users.usernameTaken: a Bloom filter in front of Postgres', async () => {
    install('username-taken.js', 'username-taken.js');
    await setConfig(['users.usernameTaken']);
    const handle = (await db.query("SELECT handle FROM users WHERE id = 'u-000010'")).rows[0]
      .handle as string;
    await redis.del('bf:usernames');
    await redis.bf.reserve('bf:usernames', 0.001, 1000);
    await redis.bf.mAdd('bf:usernames', [handle, 'quest.ghost99']);
    const real = await call(`/app/usernames/${encodeURIComponent(handle)}`);
    expect(real.body).toEqual({ name: handle, taken: true, checkedDb: true });
    expect(real.headers.get('x-quest-slots')).toBe('users.usernameTaken=learner');
    // in the filter, not in Postgres: a false positive costs a query and is answered from Postgres
    expect((await call('/app/usernames/quest.ghost99')).body).toEqual({
      name: 'quest.ghost99',
      taken: false,
      checkedDb: true,
    });
    // not in the filter: no query at all
    const m0 = (await call('/app/metrics')).body.totals['GET /app/usernames/:name'].dbQueries;
    expect((await call('/app/usernames/nobody.has.this.name')).body).toEqual({
      name: 'nobody.has.this.name',
      taken: false,
      checkedDb: false,
    });
    expect((await call('/app/metrics')).body.totals['GET /app/usernames/:name'].dbQueries).toBe(m0);
  });

  test('ops.record and ops.range: samples in, buckets out', async () => {
    install('ops-record.js', 'ops-record.js');
    install('ops-range.js', 'ops-range.js');
    await setConfig(['ops.record', 'ops.range']);
    const route = 'GET /a03/route';
    const rk = 'GET_a03_route';
    await redis.del([`ts:requests:${rk}`, `ts:errors:${rk}`, `ts:latency:${rk}`, 'td:latency']);
    for (const [at, status, ms] of [
      [60_000, 200, 10],
      [60_500, 200, 30],
      [61_000, 500, 50],
      [125_000, 200, 20],
    ])
      expect((await post('/app/ops/samples', { route, status, ms, at })).status).toBe(200);
    const w = await call(
      `/app/ops/wall?route=${encodeURIComponent(route)}&from=0&to=180000&bucket=60000`,
    );
    expect(w.status).toBe(200);
    expect(w.body.route).toBe(route);
    expect(w.body.buckets).toEqual([
      { at: 60_000, requests: 3, errors: 1, avgMs: 30 },
      { at: 120_000, requests: 1, errors: 0, avgMs: 20 },
    ]);
    // the key rule, retention, and the digest
    const info = await redis.ts.info(`ts:requests:${rk}`);
    expect(info.retentionTime).toBe(86_400_000);
    expect(await redis.tDigest.quantile('td:latency', [0.99])).toEqual([50]);
    // the same route given as the key form answers the same
    const w2 = await call(`/app/ops/wall?route=${rk}&from=0&to=180000&bucket=60000`);
    expect(w2.body.buckets).toHaveLength(2);
  });

  test('the provided hook feeds ops.record for every counted request, and not for the wall itself', async () => {
    await redis.del(OPS_KEYS);
    const before = (await call('/app/metrics')).body.totals;
    expect(before).toBeDefined();
    for (let i = 0; i < 30; i++) expect((await call('/app/players/p-028')).status).toBe(200);
    const sum = async (): Promise<number> => {
      try {
        const pts = await redis.ts.range(OPS_KEYS[0], '-', '+');
        return pts.reduce((s, p) => s + p.value, 0);
      } catch {
        return 0;
      }
    };
    await waitFor('30 samples in Redis', async () => (await sum()) === 30);
    expect(await redis.ts.get(OPS_KEYS[2])).toBeTruthy();
    // a 404 is recorded too (status 404 is not an error)
    await call('/app/players/p-999');
    await waitFor('31 samples', async () => (await sum()) === 31);
    expect((await redis.ts.info(OPS_KEYS[1])).totalSamples).toBe(0); // no 5xx, so no error samples
    // reading the wall does not add a sample for the wall route
    await call(`/app/ops/wall?route=${encodeURIComponent(OPS_ROUTE)}`);
    await sleep(300);
    expect(await redis.exists('ts:requests:GET_app_ops_wall')).toBe(0);
    expect(await redis.exists('ts:requests:POST_app_ops_samples')).toBe(0);
    const wall = await call(`/app/ops/wall?route=${encodeURIComponent(OPS_ROUTE)}&bucket=60000`);
    const total = (wall.body.buckets as Array<{ requests: number }>).reduce(
      (s, b) => s + b.requests,
      0,
    );
    expect(total).toBe(31);
  });

  test('an erroring ops.record never reaches the request and is logged once a minute', async () => {
    mkdirSync(path.join(ws, 'ch4'), { recursive: true });
    const dest = path.join(ws, 'ch4', 'ops-record.js');
    writeFileSync(dest, 'export default async function () { throw new Error("wall is down"); }\n');
    const t = new Date(Date.now() + 3000);
    utimesSync(dest, t, t);
    await setConfig(['ops.record']);
    const lines = (): number =>
      (app.output().match(/learner code in slot ops\.record failed/g) ?? []).length;
    const base = lines();
    for (let i = 0; i < 15; i++) expect((await call('/app/players/p-001')).status).toBe(200);
    await sleep(500);
    expect(lines() - base).toBeLessThanOrEqual(1);
  });

  test('a wrong return is a slot contract error (500, x-quest-slot-error)', async () => {
    const write = async (file: string, src: string): Promise<void> => {
      const dest = path.join(ws, 'ch4', file);
      writeFileSync(dest, src);
      const t = new Date(Date.now() + 5000 + Math.floor(Math.random() * 1000));
      utimesSync(dest, t, t);
    };
    await write('points-consume.js', 'export default async () => ({ processed: [1, 2] });\n');
    await write('jobs-complete.js', 'export default async () => 1;\n');
    await write('jobs-claim.js', 'export default async () => ({ id: "x" });\n');
    await write(
      'wallet-credit.js',
      'export default async () => ({ credited: "yes", balance: 1 });\n',
    );
    await write('contest-last-slot.js', 'export default async () => "true";\n');
    await write('username-taken.js', 'export default async () => ({ taken: true });\n');
    await write(
      'ops-range.js',
      'export default async () => ({ route: "r", buckets: [{ at: "x" }] });\n',
    );
    await write('jobs-reclaim.js', 'export default async () => -1;\n');
    await setConfig([
      'points.consume',
      'jobs.complete',
      'jobs.claim',
      'wallet.credit',
      'contest.claimLastSlot',
      'users.usernameTaken',
      'ops.range',
      'jobs.reclaim',
    ]);
    const bad = async (r: Res, slot: string): Promise<void> => {
      expect(r.status, slot).toBe(500);
      expect(r.body).toMatchObject({ error: 'slot_error', slot, name: 'SlotContractError' });
      expect(r.headers.get('x-quest-slot-error')).toBeTruthy();
    };
    await bad(
      await post('/app/workers/points/consume', { matchId: 'm', consumer: 'w' }),
      'points.consume',
    );
    await bad(await post('/app/jobs/abc/complete', { token: 't' }), 'jobs.complete');
    await bad(await post('/app/jobs/claim', { worker: 'w', timeoutMs: 0 }), 'jobs.claim');
    await bad(await post('/app/wallets/u/credit', { amount: 1, key: 'k' }), 'wallet.credit');
    await bad(await post('/app/contests/9003/last-slot', { userId: 'u' }), 'contest.claimLastSlot');
    await bad(await call('/app/usernames/x'), 'users.usernameTaken');
    await bad(await call('/app/ops/wall?route=r'), 'ops.range');
    await bad(await post('/app/jobs/reclaim', {}), 'jobs.reclaim');
  });
});
