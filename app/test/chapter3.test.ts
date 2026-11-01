import { copyFileSync, mkdirSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import pg from 'pg';
import { createClient } from 'redis';
import { createLearnerDeps } from '@quest/shared';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { parseBall } from '../src/workers/ticker.js';
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

// Chapter 3 app surface (A-02): leaderboard writes and rank, recompute, the wallet debit, the ticker
// subscriber. Runs the built app against the quest-a02 redis and postgres (see harness.ts).

let engine: StubEngine;
let app: RunningApp;
let ws: string;
let logDir: string;
const redis = createClient({ url: REDIS_URL });
const db = new pg.Client({ connectionString: DATABASE_URL });
const JOIN_USER = 'u-020000';
let joinBalance = 0;
let ledgerFloor = 0;
const touchedContests = new Set<number>();

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

async function health() {
  return (await call('/app/health')).body as { configEtag: string | null };
}

async function setConfig(activeSlots: string[]): Promise<void> {
  engine.config = { ...engine.config, activeSlots };
  const want = `"${engine.etag()}"`;
  await waitFor(`app to apply config ${want}`, async () => (await health()).configEtag === want);
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
  mkdirSync(path.join(ws, 'ch3'), { recursive: true });
  const dest = path.join(ws, 'ch3', target);
  copyFileSync(path.join(FIXTURES, fixture), dest);
  const t = new Date(Date.now() + Math.floor(Math.random() * 1000));
  utimesSync(dest, t, t);
}

const numsub = async (channel: string): Promise<number> => {
  const r = (await redis.sendCommand(['PUBSUB', 'NUMSUB', channel])) as unknown[];
  return Number(r[1]);
};

beforeAll(async () => {
  await redis.connect();
  await db.connect();
  const bal = await db.query('SELECT balance FROM wallets WHERE user_id = $1', [JOIN_USER]);
  joinBalance = bal.rows[0].balance as number;
  const max = await db.query('SELECT coalesce(max(id), 0) AS m FROM wallet_transactions');
  ledgerFloor = Number(max.rows[0].m);
  ws = tempDir('ws-ch3');
  logDir = tempDir('logs-ch3');
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
  // Put the shared test database back the way the seed left it.
  await db.query('UPDATE wallets SET balance = $2 WHERE user_id = $1', [JOIN_USER, joinBalance]);
  await db.query('DELETE FROM wallet_transactions WHERE id > $1 AND user_id = $2', [
    ledgerFloor,
    JOIN_USER,
  ]);
  const keys = [
    'wallet:u-a02-test',
    'contest:9001:entries',
    'lb:contest:9001',
    ...[...touchedContests].map((c) => `lb:contest:${c}`),
  ];
  await redis.del(keys).catch(() => 0);
  await db.end();
  await redis.close();
  rmSync(ws, { recursive: true, force: true });
  rmSync(logDir, { recursive: true, force: true });
});

describe('registry rows', () => {
  test('the five new slots declare file and signature', async () => {
    const { SLOTS } = await import('../src/slots/registry.js');
    const row = (n: string) => SLOTS.find((s) => s.name === n);
    expect(row('leaderboard.addPoints')).toMatchObject({
      file: 'ch3/leaderboard-add.js',
      signature: '(deps, contestId, teamId, delta)',
    });
    expect(row('leaderboard.rank')).toMatchObject({
      file: 'ch3/leaderboard-rank.js',
      signature: '(deps, contestId, teamId)',
    });
    expect(row('leaderboard.recompute')).toMatchObject({
      file: 'ch3/leaderboard-recompute.js',
      signature: '(deps, rows)',
    });
    expect(row('contest.join')).toMatchObject({
      file: 'ch3/contest-join.js',
      signature: '(deps, userId, contestId, fee)',
    });
    expect(row('ticker.publish')).toMatchObject({
      file: 'ch3/ticker-publish.js',
      signature: '(deps, matchId, ball)',
    });
  });

  test('parseBall: an integer seq makes a message well formed', () => {
    expect(parseBall('{"seq":3,"runs":4}')).toEqual({ seq: 3, runs: 4 });
    expect(parseBall('{"seq":"3"}')).toBeNull();
    expect(parseBall('{"seq":1.5}')).toBeNull();
    expect(parseBall('[1]')).toBeNull();
    expect(parseBall('nope')).toBeNull();
  });
});

describe('baseline routes', () => {
  test('every response names the instance that answered', async () => {
    const r = await call('/app/fixtures');
    expect(r.headers.get('x-quest-instance')).toMatch(/^test-/);
    expect((await call('/app/nope')).headers.get('x-quest-instance')).toMatch(/^test-/);
  });

  test('POST /app/contests/:id/points adds to the entry and returns the new score', async () => {
    const e = await db.query(
      'SELECT fantasy_team_id::text AS t, points FROM contest_entries WHERE contest_id = 1 ORDER BY id LIMIT 1',
    );
    const teamId = e.rows[0].t as string;
    const before = Number(e.rows[0].points);
    const r = await post('/app/contests/1/points', { teamId, delta: 2.5 });
    expect(r.status).toBe(200);
    expect(r.body).toEqual({ contestId: 1, teamId, score: before + 2.5 });
    expect(r.headers.get('x-quest-slots')).toBe('leaderboard.addPoints=baseline');
    const back = await post('/app/contests/1/points', { teamId, delta: -2.5 });
    expect(back.body.score).toBe(before);
  });

  test('points: unknown team 404, bad bodies 400', async () => {
    const unknown = await post('/app/contests/1/points', { teamId: '999999999', delta: 1 });
    expect(unknown.status).toBe(404);
    expect(unknown.body).toMatchObject({ error: 'entry_not_found' });
    expect(
      (await post('/app/contests/1/points', { teamId: 'not-a-number', delta: 1 })).status,
    ).toBe(404);
    expect((await post('/app/contests/1/points', { teamId: '1' })).body.error).toBe(
      'invalid_delta',
    );
    expect((await post('/app/contests/1/points', { teamId: '1', delta: 'x' })).status).toBe(400);
    expect((await post('/app/contests/1/points', { delta: 1 })).body.error).toBe('invalid_team_id');
    expect((await post('/app/contests/0/points', { teamId: '1', delta: 1 })).status).toBe(400);
  });

  test('GET /app/leaderboard/:id/teams/:teamId gives rank and the window around', async () => {
    const top = await db.query(
      'SELECT fantasy_team_id::text AS t, points FROM contest_entries WHERE contest_id = 1 ORDER BY points DESC, id LIMIT 1',
    );
    const first = await call(`/app/leaderboard/1/teams/${top.rows[0].t}`);
    expect(first.status).toBe(200);
    expect(first.body.rank).toBe(1);
    expect(first.body.score).toBe(Number(top.rows[0].points));
    expect(first.body.around).toHaveLength(3); // nobody above: rank 1, 2 and 3

    const mid = await db.query(
      'SELECT fantasy_team_id::text AS t FROM contest_entries WHERE contest_id = 1 ORDER BY points DESC, id OFFSET 100 LIMIT 1',
    );
    const r = await call(`/app/leaderboard/1/teams/${mid.rows[0].t}`);
    expect(r.body.rank).toBe(101);
    expect(r.body.around).toHaveLength(5);
    const scores = (r.body.around as Array<{ teamId: string; score: number }>).map((e) => e.score);
    expect([...scores].sort((a, b) => b - a)).toEqual(scores);
    expect(r.body.around[2]).toEqual({ teamId: mid.rows[0].t, score: r.body.score });
    expect(typeof r.body.around[0].teamId).toBe('string');

    // agrees with the top route
    const list = await call('/app/leaderboard/1?limit=3');
    expect(list.body.entries[0].teamId).toBe(top.rows[0].t);
  });

  test('rank: a team that is not in the contest is 404', async () => {
    expect((await call('/app/leaderboard/1/teams/999999999')).body).toMatchObject({
      error: 'entry_not_found',
    });
    expect((await call('/app/leaderboard/1/teams/abc')).status).toBe(404);
    expect((await call('/app/leaderboard/zero/teams/1')).status).toBe(400);
  });

  test('POST /app/leaderboards/recompute loads the rows once and times the slot', async () => {
    const r = await post('/app/leaderboards/recompute', { matchIds: ['m-001'] });
    expect(r.status).toBe(200);
    expect(r.body.ok).toBe(true);
    expect(r.body.rows).toBeGreaterThanOrEqual(1000);
    expect(typeof r.body.ms).toBe('number');
    expect(r.body.result).toBeNull();
    const n = await db.query(
      "SELECT count(*)::int AS n FROM contest_entries ce JOIN contests c ON c.id = ce.contest_id WHERE c.match_id = 'm-001'",
    );
    expect(r.body.rows).toBe(n.rows[0].n);
    expect((await post('/app/leaderboards/recompute', { matchIds: ['no-such'] })).body.rows).toBe(
      0,
    );
    expect((await post('/app/leaderboards/recompute', { matchIds: [] })).status).toBe(400);
    const eleven = Array.from({ length: 11 }, (_, i) => `m-${String(i + 1).padStart(3, '0')}`);
    expect((await post('/app/leaderboards/recompute', { matchIds: eleven })).status).toBe(400);
    expect((await post('/app/leaderboards/recompute', {})).status).toBe(400);
  });

  test('contest.join takes the fee once and writes one ledger row', async () => {
    const r = await post('/app/contests/9001/join', { userId: JOIN_USER });
    expect(r.status).toBe(200);
    expect(r.body).toEqual({ joined: true });
    expect(r.headers.get('x-quest-slots')).toBe('contest.join=baseline');
    const w = await db.query('SELECT balance FROM wallets WHERE user_id = $1', [JOIN_USER]);
    expect(w.rows[0].balance).toBe(joinBalance - 10);
    const t = await db.query(
      'SELECT delta, reason, ref FROM wallet_transactions WHERE id > $1 AND user_id = $2',
      [ledgerFloor, JOIN_USER],
    );
    expect(t.rows).toEqual([{ delta: -10, reason: 'contest_entry', ref: '9001' }]);
  });

  test('contest.join refuses when the balance is too short and leaves no trace', async () => {
    const r = await post('/app/contests/9001/join', { userId: JOIN_USER, fee: 100_000 });
    expect(r.status).toBe(402);
    expect(r.body).toEqual({ error: 'insufficient_balance' });
    const w = await db.query('SELECT balance FROM wallets WHERE user_id = $1', [JOIN_USER]);
    expect(w.rows[0].balance).toBe(joinBalance - 10);
    const t = await db.query(
      'SELECT count(*)::int AS n FROM wallet_transactions WHERE id > $1 AND user_id = $2',
      [ledgerFloor, JOIN_USER],
    );
    expect(t.rows[0].n).toBe(1);
    // an unknown user has no wallet: nothing to debit
    expect((await post('/app/contests/9001/join', { userId: 'u-nobody' })).status).toBe(402);
  });

  test('join validation', async () => {
    expect((await post('/app/contests/9001/join', {})).body.error).toBe('invalid_user_id');
    expect((await post('/app/contests/9001/join', { userId: 'u', fee: 0 })).body.error).toBe(
      'invalid_fee',
    );
    expect((await post('/app/contests/9001/join', { userId: 'u', fee: 1.5 })).status).toBe(400);
    expect((await post('/app/contests/9001/join', { userId: 'u', fee: 100_001 })).status).toBe(400);
    expect((await post('/app/contests/abc/join', { userId: 'u' })).status).toBe(400);
  });

  test('POST /app/matches/:id/balls with the baseline publishes nothing', async () => {
    const before = (await call('/app/ticker/m-041')).body.received as number;
    const r = await post('/app/matches/m-041/balls', {
      seq: 1,
      over: 1,
      ball: 1,
      batter: 'p-028',
      runs: 4,
    });
    expect(r.status).toBe(200);
    expect(r.body).toEqual({ ok: true, matchId: 'm-041', result: 0 });
    expect(r.headers.get('x-quest-slots')).toBe('ticker.publish=baseline');
    await sleep(300);
    expect((await call('/app/ticker/m-041')).body.received).toBe(before);
  });

  test('ball validation', async () => {
    expect((await post('/app/matches/m-041/balls', {})).body.error).toBe('invalid_seq');
    expect((await post('/app/matches/m-041/balls', { seq: 0 })).status).toBe(400);
    expect((await post('/app/matches/m-041/balls', { seq: 1.5 })).status).toBe(400);
    expect((await post('/app/matches/m-041/balls', { seq: 1, runs: 'four' })).body.error).toBe(
      'invalid_runs',
    );
    expect(
      (await post('/app/matches/m-041/balls', { seq: 1, commentary: 'x'.repeat(201) })).body.error,
    ).toBe('invalid_commentary');
    expect((await post('/app/matches/m-041/balls', { seq: 1, wicket: 3 })).status).toBe(400);
  });
});

describe('ticker subscriber', () => {
  test('subscribes to every live match on an exact channel, nothing else', async () => {
    for (const id of ['m-041', 'm-042']) {
      const v = await waitFor(`${id} subscribed`, async () => {
        const r = await call(`/app/ticker/${id}`);
        return r.body.subscribed === true ? r : undefined;
      });
      expect(v.body).toMatchObject({
        matchId: id,
        subscribed: true,
        received: 0,
        lastSeq: null,
        last: null,
        recent: [],
        gaps: 0,
        malformed: 0,
      });
      expect(v.body.instance).toMatch(/^test-/);
      expect(await numsub(`score:match:${id}`)).toBeGreaterThanOrEqual(1);
    }
    expect((await call('/app/ticker/m-001')).body).toMatchObject({ error: 'unknown_match' });
    expect((await call('/app/ticker/m-001')).status).toBe(404);
  });

  test('receives messages in order and keeps the last 20', async () => {
    for (let seq = 1; seq <= 25; seq++) {
      await redis.publish(
        'score:match:m-041',
        JSON.stringify({ seq, over: 1, ball: (seq % 6) + 1, runs: seq % 7 }),
      );
    }
    const v = await waitFor('25 messages', async () => {
      const r = await call('/app/ticker/m-041');
      return r.body.received === 25 ? r : undefined;
    });
    expect(v.body.lastSeq).toBe(25);
    expect(v.body.gaps).toBe(0);
    expect(v.body.recent).toHaveLength(20);
    expect(v.body.recent[0].seq).toBe(6);
    expect(v.body.last).toMatchObject({ seq: 25 });
    expect(engine.events).toHaveLength(0); // no gap, no event
  });

  test('malformed messages count, and do not move lastSeq or raise a gap', async () => {
    await redis.publish('score:match:m-041', 'not json');
    await redis.publish('score:match:m-041', JSON.stringify({ seq: '26' }));
    await redis.publish('score:match:m-041', JSON.stringify({ runs: 4 }));
    const v = await waitFor('3 malformed', async () => {
      const r = await call('/app/ticker/m-041');
      return r.body.malformed === 3 ? r : undefined;
    });
    expect(v.body).toMatchObject({ received: 28, lastSeq: 25, gaps: 0 });
  });

  test('a skipped seq is a gap: counted, and reported to the engine as ticker_gap', async () => {
    await redis.publish('score:match:m-041', JSON.stringify({ seq: 28, runs: 1 }));
    const v = await waitFor('gap counted', async () => {
      const r = await call('/app/ticker/m-041');
      return r.body.gaps === 1 ? r : undefined;
    });
    expect(v.body.lastSeq).toBe(28);
    const ev = await waitFor('ticker_gap event', () => engine.events[0]);
    expect(ev).toEqual({
      kind: 'custom',
      name: 'ticker_gap',
      data: {
        matchId: 'm-041',
        instance: expect.stringMatching(/^test-/),
        expected: 26,
        got: 28,
        missed: 2,
      },
    });
  });

  test('resubscribe: messages published during the pause are lost, and the next one shows the gap', async () => {
    const base = (await call('/app/ticker/m-042')).body;
    expect(base.received).toBe(0);
    await redis.publish('score:match:m-042', JSON.stringify({ seq: 1 }));
    await waitFor('seq 1', async () => (await call('/app/ticker/m-042')).body.lastSeq === 1);

    // Other instances (the compose app, when this runs inside the check) may be subscribed too.
    const others = (await numsub('score:match:m-042')) - 1;
    const resub = post('/app/ticker/resubscribe', { matchId: 'm-042', pauseMs: 800 });
    await waitFor(
      'channel unsubscribed',
      async () => (await numsub('score:match:m-042')) === others,
      3000,
    );
    expect((await call('/app/ticker/m-042')).body.subscribed).toBe(false);
    const lost2 = await redis.publish('score:match:m-042', JSON.stringify({ seq: 2 }));
    const lost3 = await redis.publish('score:match:m-042', JSON.stringify({ seq: 3 }));
    expect([lost2, lost3]).toEqual([others, others]); // PUBLISH counts only the other subscribers

    const done = await resub;
    expect(done.status).toBe(200);
    expect(done.body).toMatchObject({ ok: true, instance: expect.stringMatching(/^test-/) });
    expect(done.body.pausedMs).toBeGreaterThanOrEqual(800);
    // answered only after the new subscription is confirmed
    expect(await numsub('score:match:m-042')).toBeGreaterThanOrEqual(1);
    expect((await call('/app/ticker/m-042')).body.subscribed).toBe(true);

    await redis.publish('score:match:m-042', JSON.stringify({ seq: 4 }));
    const v = await waitFor('gap after resubscribe', async () => {
      const r = await call('/app/ticker/m-042');
      return r.body.gaps === 1 ? r : undefined;
    });
    expect(v.body).toMatchObject({ received: 2, lastSeq: 4 });
    const ev = await waitFor('second ticker_gap', () => engine.events[1]);
    expect(ev).toMatchObject({
      name: 'ticker_gap',
      data: { matchId: 'm-042', expected: 2, got: 4, missed: 2 },
    });
  });

  test('resubscribe validation', async () => {
    expect((await post('/app/ticker/resubscribe', { matchId: 'm-001' })).status).toBe(404);
    expect((await post('/app/ticker/resubscribe', {})).status).toBe(400);
    expect(
      (await post('/app/ticker/resubscribe', { matchId: 'm-041', pauseMs: 10_001 })).status,
    ).toBe(400);
    expect((await post('/app/ticker/resubscribe', { matchId: 'm-041', pauseMs: -1 })).status).toBe(
      400,
    );
    const quick = await post('/app/ticker/resubscribe', { matchId: 'm-041', pauseMs: 0 });
    expect(quick.status).toBe(200);
  });

  test('ticker routes are game routes: counted in the metrics totals', async () => {
    const m = (await call('/app/metrics')).body as { totals: Record<string, { count: number }> };
    expect(m.totals['GET /app/ticker/:matchId'].count).toBeGreaterThan(0);
    expect(m.totals['POST /app/ticker/resubscribe'].count).toBeGreaterThan(0);
  });
});

describe('learner path with the reference fixtures', () => {
  test('leaderboard top, points and rank agree with the sorted set', async () => {
    install('leaderboard-top.js', 'leaderboard.js');
    install('leaderboard-add.js', 'leaderboard-add.js');
    install('leaderboard-rank.js', 'leaderboard-rank.js');
    await setConfig(['leaderboard.top', 'leaderboard.addPoints', 'leaderboard.rank']);

    // 1000 members, score = i, team ids t0001..t1000
    await redis.del('lb:contest:9001');
    const batch = redis.multi();
    for (let i = 1; i <= 1000; i++)
      batch.zAdd('lb:contest:9001', { score: i, value: `t${String(i).padStart(4, '0')}` });
    await batch.execAsPipeline();

    const top = await call('/app/leaderboard/9001?limit=3');
    expect(top.headers.get('x-quest-slots')).toBe('leaderboard.top=learner');
    expect(top.body.entries.map((e: { teamId: string }) => e.teamId)).toEqual([
      't1000',
      't0999',
      't0998',
    ]);
    expect(top.body.entries[0]).toMatchObject({ rank: 1, points: 1000 });

    const add = await post('/app/contests/9001/points', { teamId: 't0500', delta: 700 });
    expect(add.status).toBe(200);
    expect(add.body).toEqual({ contestId: 9001, teamId: 't0500', score: 1200 });
    expect(add.headers.get('x-quest-slots')).toBe('leaderboard.addPoints=learner');
    expect((await post('/app/contests/9001/points', { teamId: 'ghost', delta: 1 })).status).toBe(
      404,
    );
    expect(await redis.zScore('lb:contest:9001', 'ghost')).toBeNull(); // not created by the miss

    const rank = await call('/app/leaderboard/9001/teams/t0500');
    expect(rank.status).toBe(200);
    expect(rank.body.rank).toBe(1);
    expect(rank.body.score).toBe(1200);
    expect(rank.body.around.map((e: { teamId: string }) => e.teamId)).toEqual([
      't0500',
      't1000',
      't0999',
    ]);
    const mid = await call('/app/leaderboard/9001/teams/t0100');
    expect(mid.body.rank).toBe(901); // t0101..t1000 score higher (t0500 is still one member)
    expect(mid.body.around).toHaveLength(5);
    expect(mid.body.around[2].teamId).toBe('t0100');
    expect((await call('/app/leaderboard/9001/teams/ghost')).status).toBe(404);
  });

  test('recompute rebuilds the sorted sets with pipelined batches', async () => {
    install('leaderboard-recompute.js', 'leaderboard-recompute.js');
    await setConfig(['leaderboard.recompute']);
    const rows = await db.query(
      "SELECT c.id::int AS id FROM contests c WHERE c.match_id = 'm-001' ORDER BY c.id",
    );
    for (const r of rows.rows) touchedContests.add(r.id as number);
    await redis.del([...touchedContests].map((c) => `lb:contest:${c}`));
    const r = await post('/app/leaderboards/recompute', { matchIds: ['m-001'] });
    expect(r.status).toBe(200);
    expect(r.body.result).toEqual({ loaded: r.body.rows });
    expect(r.headers.get('x-quest-slots')).toBe('leaderboard.recompute=learner');
    const total = await db.query(
      "SELECT count(DISTINCT (ce.contest_id, ce.fantasy_team_id))::int AS n FROM contest_entries ce JOIN contests c ON c.id = ce.contest_id WHERE c.match_id = 'm-001'",
    );
    let cards = 0;
    for (const c of touchedContests) cards += await redis.zCard(`lb:contest:${c}`);
    expect(cards).toBe(total.rows[0].n);
  }, 30_000);

  test('contest.join with WATCH: 50 parallel joins on a wallet of 100 at fee 10 take exactly 10', async () => {
    install('contest-join.js', 'contest-join.js');
    await setConfig(['contest.join']);
    await redis.del(['wallet:u-a02-test', 'contest:9001:entries']);
    await redis.set('wallet:u-a02-test', '100');
    const results = await Promise.all(
      Array.from({ length: 50 }, () => post('/app/contests/9001/join', { userId: 'u-a02-test' })),
    );
    const ok = results.filter((r) => r.status === 200).length;
    const refused = results.filter((r) => r.status === 402).length;
    expect({ ok, refused }).toEqual({ ok: 10, refused: 40 });
    expect(await redis.get('wallet:u-a02-test')).toBe('0');
    expect(await redis.get('contest:9001:entries')).toBe('10');
    expect(results[0].headers.get('x-quest-slots')).toBe('contest.join=learner');
  }, 30_000);

  test('ticker.publish with the reference code reaches the subscriber', async () => {
    install('ticker-publish.js', 'ticker-publish.js');
    await setConfig(['ticker.publish']);
    const before = (await call('/app/ticker/m-041')).body;
    const r = await post('/app/matches/m-041/balls', {
      seq: (before.lastSeq as number) + 1,
      over: 4,
      ball: 2,
      batter: 'p-028',
      runs: 6,
    });
    expect(r.status).toBe(200);
    expect(r.body.result).toBeGreaterThanOrEqual(1); // at least this instance's subscriber
    const after = await waitFor('one more message', async () => {
      const v = await call('/app/ticker/m-041');
      return v.body.received === before.received + 1 ? v : undefined;
    });
    expect(after.body.last).toMatchObject({ seq: before.lastSeq + 1, runs: 6, matchId: 'm-041' });
    expect(after.body.gaps).toBe(before.gaps);
  });

  test('a wrong return is a slot contract error (500, x-quest-slot-error)', async () => {
    mkdirSync(path.join(ws, 'ch3'), { recursive: true });
    // contest.join must say true or false
    const dest = path.join(ws, 'ch3', 'contest-join.js');
    writeFileSync(dest, 'export default async function join() { return 1; }\n');
    const t = new Date(Date.now() + 2000);
    utimesSync(dest, t, t);
    await setConfig(['contest.join']);
    const r = await post('/app/contests/9001/join', { userId: 'u-a02-test' });
    expect(r.status).toBe(500);
    expect(r.body).toMatchObject({ error: 'slot_error', slot: 'contest.join' });
    expect(r.headers.get('x-quest-slot-error')).toMatch(/true.*false/);
  });
});

describe('WATCH facts (node-redis v5, measured)', () => {
  test('after a failed WATCH, exec() throws a WatchError (name is "Error") and nothing runs', async () => {
    const { WatchError } = await import('redis');
    const a = createClient({ url: REDIS_URL });
    await a.connect();
    try {
      await a.set('test:a02:w', '1');
      await a.watch('test:a02:w');
      await redis.set('test:a02:w', '2'); // another connection touches the key
      let thrown: unknown;
      let returned: unknown = 'not reached';
      try {
        returned = await a.multi().set('test:a02:w', '3').exec();
      } catch (err) {
        thrown = err;
      }
      expect(returned).toBe('not reached'); // it does not return null in this client
      expect(thrown).toBeInstanceOf(WatchError);
      expect((thrown as Error).name).toBe('Error');
      expect((thrown as Error).constructor.name).toBe('WatchError');
      expect((thrown as Error).message).toMatch(/watched keys has been changed/);
      expect(await redis.get('test:a02:w')).toBe('2');
      // EXEC cleared the watch: the next transaction on the same connection goes through
      expect(await a.multi().set('test:a02:w', '4').exec()).toEqual(['OK']);
    } finally {
      await a.del('test:a02:w');
      await a.close();
    }
  });

  test('execAsPipeline() is not a transaction: it ignores a WATCH that fired', async () => {
    const a = createClient({ url: REDIS_URL });
    await a.connect();
    try {
      await a.watch('test:a02:p');
      await redis.set('test:a02:p', 'other');
      const out = await a.multi().set('test:a02:p', 'mine').execAsPipeline();
      expect(out).toEqual(['OK']);
      expect(await redis.get('test:a02:p')).toBe('mine');
    } finally {
      await a.del('test:a02:p');
      await a.close();
    }
  });

  test('a duplicate() of the learner client is closed until the learner connect()s it', async () => {
    const ctx = await createLearnerDeps({ redisClient: redis as never });
    try {
      const dup = ctx.deps.redis.duplicate();
      await expect(dup.get('test:a02:d')).rejects.toThrow(/closed/i);
      await dup.connect(); // a duplicate's own connect() is real (only the shared client's is a no-op)
      expect(await dup.get('test:a02:d')).toBeNull();
      await dup.watch('test:a02:d');
      await redis.set('test:a02:d', 'x');
      await expect(dup.multi().set('test:a02:d', 'y').exec()).rejects.toThrow(/watched keys/);
      // the shared client's connect() stays a no-op
      await expect(ctx.deps.redis.connect()).resolves.toBeDefined();
    } finally {
      await ctx.close(); // closes the duplicate
      await redis.del('test:a02:d');
    }
  });
});
