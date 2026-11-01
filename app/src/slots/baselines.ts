import { randomBytes } from 'node:crypto';
import { createClient } from 'redis';
import type { LearnerDeps } from '@quest/shared';
import { HttpError } from '../errors.js';

// Baselines are deliberately the slow or naive version. Do not "fix" them: each is a lesson.

/** Chapter 2: the slow-by-design aggregate. Exactly this statement; no index, no Postgres-side cache. */
export async function getPlayerStats(deps: LearnerDeps, playerId: string): Promise<unknown> {
  const { rows } = await deps.db.query('SELECT * FROM player_stats($1)', [playerId]);
  return rows[0] ?? null;
}

/**
 * Chapter 2: nothing to invalidate without a cache. It touches the player row (a no-op UPDATE), which
 * also writes an outbox row through the P0-04 trigger. players has no updated_at column.
 */
export async function invalidatePlayerStats(deps: LearnerDeps, playerId: string): Promise<unknown> {
  const { rows } = await deps.db.query(
    'UPDATE players SET name = name WHERE id = $1 RETURNING id',
    [playerId],
  );
  return { touched: rows.length };
}

/** Chapter 2 prefetch: the small hot list, straight from Postgres every time. */
export async function getFixtures(deps: LearnerDeps): Promise<unknown> {
  const { rows } = await deps.db.query(
    `SELECT id, season, home_team_id, away_team_id, venue, starts_at, status
       FROM matches WHERE status IN ('scheduled', 'live') ORDER BY starts_at, id`,
  );
  return rows;
}

/**
 * Chapter 2 prefetch (2.7): the baseline cache does not exist, so there is nothing to load . The learner's
 * version fills `cache:match:*` from `rows` (the whole matches table joined with team names).
 */
export async function bulkLoadMatches(): Promise<unknown> {
  return null;
}

/** Chapter 2 prefetch (2.7): no cache to keep fresh, so a change event is ignored. */
export async function applyMatchChange(): Promise<unknown> {
  return null;
}

/** One row of the full `matches` table with the team names, as `prefetch.bulkLoad` receives it. */
export interface MatchRow {
  id: string;
  season: number;
  home_team_id: string;
  away_team_id: string;
  home_team_name: string;
  away_team_name: string;
  venue: string;
  starts_at: string;
  status: string;
}

/** What the stream consumer hands `prefetch.applyChange`, decoded from one `legacydb:changes` entry. */
export interface ChangeEvent {
  aggregate: string;
  aggregateId: string;
  op: 'insert' | 'update' | 'delete';
  /** The row as the trigger saw it (old row on delete), parsed from the stream's JSON string. */
  payload: Record<string, unknown>;
}

/** The rows `prefetch.bulkLoad` gets: every match, newest id last, `starts_at` as an ISO string. */
export async function loadMatchRows(deps: LearnerDeps): Promise<MatchRow[]> {
  const { rows } = await deps.db.query(
    `SELECT m.id, m.season, m.home_team_id, m.away_team_id, h.name AS home_team_name,
            a.name AS away_team_name, m.venue, to_char(m.starts_at AT TIME ZONE 'UTC',
            'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS starts_at, m.status
       FROM matches m
       JOIN teams h ON h.id = m.home_team_id
       JOIN teams a ON a.id = m.away_team_id
      ORDER BY m.id`,
  );
  return rows as MatchRow[];
}

// Chapter 3.1 lesson: sessions in process memory vanish on restart and do not exist on the other
// instance after `--scale app=2`. Bounded so a load test cannot grow it forever.
const SESSION_CAP = 100_000;
const sessions = new Map<string, { userId: string; name: string; createdAt: string }>();

export interface SessionUser {
  id: string;
  handle: string;
  display_name: string;
  college_id: string;
  hostel_id: string;
}

export async function createSession(_deps: LearnerDeps, user: SessionUser): Promise<string> {
  const sid = randomBytes(16).toString('hex');
  if (sessions.size >= SESSION_CAP) {
    const oldest = sessions.keys().next().value;
    if (oldest !== undefined) sessions.delete(oldest);
  }
  sessions.set(sid, {
    userId: user.id,
    name: user.display_name,
    createdAt: new Date().toISOString(),
  });
  return sid;
}

export async function getSession(_deps: LearnerDeps, sid: string): Promise<unknown> {
  return sessions.get(sid) ?? null;
}

/** Logout: forget one session. The baseline is the same per-instance Map, so another instance still has it. */
export async function destroySession(_deps: LearnerDeps, sid: string): Promise<unknown> {
  return { destroyed: sessions.delete(sid) };
}

/** Logout everywhere: a linear scan of the Map, and blind to sessions held by the other instance. */
export async function destroyAllSessions(_deps: LearnerDeps, userId: string): Promise<unknown> {
  let destroyed = 0;
  for (const [sid, s] of sessions) {
    if (s.userId === userId) {
      sessions.delete(sid);
      destroyed += 1;
    }
  }
  return { destroyed };
}

/** Chapter 3 leaderboard: ORDER BY over the unindexed contest_entries table on every read. */
export async function leaderboardTop(
  deps: LearnerDeps,
  contestId: number,
  limit: number,
): Promise<unknown> {
  const { rows } = await deps.db.query(
    `SELECT fantasy_team_id, user_id, points FROM contest_entries
      WHERE contest_id = $1 ORDER BY points DESC, id LIMIT $2`,
    [contestId, limit],
  );
  return (rows as Array<{ fantasy_team_id: string; user_id: string; points: string }>).map((r) => ({
    teamId: r.fantasy_team_id,
    userId: r.user_id,
    points: Number(r.points),
  }));
}

/** Postgres bigint ids arrive as strings from `pg`; only digit strings can name a contest entry. */
const BIGINT_ID = /^[0-9]{1,18}$/;

/**
 * Chapter 3.2: the write path is an UPDATE on an unindexed table. A team id that is not a number cannot
 * exist (fantasy_team_id is a bigint), so it is "not found" rather than a Postgres cast error.
 */
export async function leaderboardAddPoints(
  deps: LearnerDeps,
  contestId: number,
  teamId: string,
  delta: number,
): Promise<number | null> {
  if (!BIGINT_ID.test(teamId)) return null;
  const { rows } = await deps.db.query(
    `UPDATE contest_entries SET points = points + $3
      WHERE contest_id = $1 AND fantasy_team_id = $2 RETURNING points`,
    [contestId, teamId, delta],
  );
  const row = rows[0] as { points: string } | undefined;
  return row ? Number(row.points) : null;
}

export interface RankEntry {
  teamId: string;
  score: number;
}

/**
 * Chapter 3.2: "where am I" costs a window function over every entry of the contest (a sequential scan
 * of the whole table, then a sort), on every read. Rank 1 is the best score; ties break by entry id.
 */
export async function leaderboardRank(
  deps: LearnerDeps,
  contestId: number,
  teamId: string,
): Promise<{ rank: number; score: number; around: RankEntry[] } | null> {
  if (!BIGINT_ID.test(teamId)) return null;
  const { rows } = await deps.db.query(
    `WITH ranked AS (
       SELECT fantasy_team_id::text AS team_id, points,
              row_number() OVER (ORDER BY points DESC, id) AS rn
         FROM contest_entries WHERE contest_id = $1
     ), me AS (SELECT rn FROM ranked WHERE team_id = $2)
     SELECT r.team_id, r.points, r.rn, (r.rn = me.rn) AS is_me
       FROM ranked r, me WHERE r.rn BETWEEN me.rn - 2 AND me.rn + 2 ORDER BY r.rn`,
    [contestId, teamId],
  );
  const list = rows as Array<{ team_id: string; points: string; rn: string; is_me: boolean }>;
  const mine = list.find((r) => r.is_me);
  if (!mine) return null;
  return {
    rank: Number(mine.rn),
    score: Number(mine.points),
    around: list.map((r) => ({ teamId: r.team_id, score: Number(r.points) })),
  };
}

/** One contest entry as `leaderboard.recompute` receives it. */
export interface RecomputeRow {
  contestId: number;
  teamId: string;
  points: number;
}

/**
 * Chapter 3.3: the baseline does nothing, because Postgres already holds the truth. The level measures the
 * learner's write path: how fast their code can rebuild the sorted sets from `rows` (one round trip per
 * thousands of commands, not one per row).
 */
export async function leaderboardRecompute(): Promise<unknown> {
  return null;
}

/** The rows the recompute route loads once and hands to `leaderboard.recompute`. */
export async function loadRecomputeRows(
  deps: LearnerDeps,
  matchIds: string[],
): Promise<RecomputeRow[]> {
  const { rows } = await deps.db.query(
    `SELECT ce.contest_id, ce.fantasy_team_id, ce.points
       FROM contest_entries ce JOIN contests c ON c.id = ce.contest_id
      WHERE c.match_id = ANY($1)`,
    [matchIds],
  );
  return (rows as Array<{ contest_id: string; fantasy_team_id: string; points: string }>).map(
    (r) => ({
      contestId: Number(r.contest_id),
      teamId: r.fantasy_team_id,
      points: Number(r.points),
    }),
  );
}

/**
 * Chapter 3.4: the wallet debit, correct and slow. One statement is one transaction in Postgres: the
 * guarded UPDATE takes the row lock (concurrent debits queue on it and re-check the balance after the
 * lock), and the ledger row is inserted from the rows the UPDATE actually changed, so a refused debit
 * leaves no trace. The learner's version does the same job in Redis, where the race is theirs to solve.
 */
export async function contestJoin(
  deps: LearnerDeps,
  userId: string,
  contestId: number,
  fee: number,
): Promise<boolean> {
  const { rows } = await deps.db.query(
    `WITH debit AS (
       UPDATE wallets SET balance = balance - $2
        WHERE user_id = $1 AND balance >= $2 RETURNING user_id
     )
     INSERT INTO wallet_transactions (user_id, delta, reason, ref, created_at)
     SELECT user_id, -$2::integer, 'contest_entry', $3::text, now() FROM debit
     RETURNING id`,
    [userId, fee, String(contestId)],
  );
  return rows.length === 1;
}

/**
 * Chapter 3.5: the ticker baseline publishes nothing, so a level that grades "a message reached the
 * channel" only passes with the learner's code. The natural learner return is PUBLISH's receiver count.
 */
export async function tickerPublish(): Promise<number> {
  return 0;
}

/** Chapter 3 rate limit: fixed window in process memory, per instance (so scaling doubles the limit). */
export const RATE_LIMIT = { limit: 10, windowMs: 60_000 } as const;
const windows = new Map<string, { start: number; count: number }>();

export async function rateLimitAllow(_deps: LearnerDeps, userId: string): Promise<boolean> {
  const now = Date.now();
  const start = now - (now % RATE_LIMIT.windowMs);
  const w = windows.get(userId);
  if (!w || w.start !== start) {
    if (windows.size > 100_000) windows.clear();
    windows.set(userId, { start, count: 1 });
    return true;
  }
  w.count += 1;
  return w.count <= RATE_LIMIT.limit;
}

export interface NewUser {
  id: string;
  name: string;
  college_id: string;
  hostel_id: string;
}

/** Chapter 1.16: Postgres only. The level adds the Redis side (hash, set, zset at 0) in one MULTI. */
export async function registerUser(deps: LearnerDeps, user: NewUser): Promise<unknown> {
  try {
    const { rows } = await deps.db.query(
      `INSERT INTO users (id, handle, display_name, college_id, hostel_id, created_at)
       VALUES ($1, $1, $2, $3, $4, now()) ON CONFLICT DO NOTHING RETURNING id`,
      [user.id, user.name, user.college_id, user.hostel_id],
    );
    return { created: rows.length === 1 };
  } catch (err) {
    if ((err as { code?: string }).code === '23503') {
      throw new HttpError(400, 'invalid_reference', 'college_id or hostel_id does not exist');
    }
    throw err;
  }
}

// ---- Chapter 4: work in the background -----------------------------------------------------------

/**
 * Chapter 4.2 and 4.3: the legacy points path recomputes from the `balls` table and never touches a stream, so
 * it processes and acks nothing. The SELECT is here so the baseline is honest about where the points come from.
 */
export async function pointsConsume(
  deps: LearnerDeps,
  matchId: string,
  _consumer: string,
  count: number,
): Promise<{ processed: string[] }> {
  await deps.db.query(
    `SELECT "over", ball, batter_id, runs FROM balls WHERE match_id = $1 ORDER BY id LIMIT $2`,
    [matchId, count],
  );
  return { processed: [] };
}

/** Chapter 4.3 and 4.4: nothing is pending in the legacy path, so there is nothing to reclaim or dead-letter. */
export async function pointsSweep(): Promise<{ reclaimed: string[]; deadLettered: string[] }> {
  return { reclaimed: [], deadLettered: [] };
}

/**
 * Chapters 4.7 to 4.9: the job queue as most first versions are written, a plain array in this process's memory.
 * It "works" on one instance, and it is wrong in three ways the levels walk through: a second instance has its
 * own queue, a restart empties it, and a job a worker took and lost is simply gone (no visibility timeout).
 */
interface MemJob {
  id: string;
  payload: unknown;
  token: string;
  attempts: number;
}
const mem = {
  pending: [] as MemJob[],
  processing: new Map<string, MemJob>(),
  completed: 0,
  failed: 0,
  delayed: 0,
};
const hex16 = (): string => randomBytes(8).toString('hex');

/** What the in-process queue holds right now (reported by GET /app/jobs/stats under `inMemory`). */
export function inMemoryQueueStats(): {
  pending: number;
  processing: number;
  completed: number;
  failed: number;
  delayed: number;
} {
  return {
    pending: mem.pending.length,
    processing: mem.processing.size,
    completed: mem.completed,
    failed: mem.failed,
    delayed: mem.delayed,
  };
}

export async function jobsEnqueue(_deps: LearnerDeps, payload: unknown): Promise<string> {
  if (mem.pending.length >= 100_000) mem.pending.shift(); // a cap so a forgotten loop cannot eat the heap
  const id = hex16();
  mem.pending.push({ id, payload, token: '', attempts: 0 });
  return id;
}

export async function jobsClaim(
  _deps: LearnerDeps,
  _worker: string,
  timeoutMs: number,
): Promise<{ id: string; payload: unknown; token: string; attempts: number } | null> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const job = mem.pending.shift();
    if (job) {
      job.token = hex16();
      job.attempts += 1;
      mem.processing.set(job.id, job);
      return { id: job.id, payload: job.payload, token: job.token, attempts: job.attempts };
    }
    if (Date.now() >= deadline) return null;
    await new Promise((r) => setTimeout(r, Math.min(25, Math.max(1, deadline - Date.now()))));
  }
}

export async function jobsComplete(
  _deps: LearnerDeps,
  id: string,
  token: string,
): Promise<boolean> {
  const job = mem.processing.get(id);
  if (!job || job.token !== token) return false;
  mem.processing.delete(id);
  mem.completed += 1;
  return true;
}

export async function jobsFail(
  _deps: LearnerDeps,
  id: string,
  token: string,
  _error: string,
  maxAttempts: number,
): Promise<'retry' | 'failed' | false> {
  const job = mem.processing.get(id);
  if (!job || job.token !== token) return false;
  mem.processing.delete(id);
  if (job.attempts >= maxAttempts) {
    mem.failed += 1;
    return 'failed';
  }
  mem.pending.push(job);
  return 'retry';
}

/** A job lost in `processing` stays there for ever: nobody looks. That is the bug, so the baseline moves nothing. */
export async function jobsReclaim(): Promise<number> {
  return 0;
}

/** A timer in this process: it fires only if this exact process is still alive at `runAtMs`. */
export async function jobsSchedule(
  _deps: LearnerDeps,
  payload: unknown,
  runAtMs: number,
): Promise<string> {
  const id = hex16();
  mem.delayed += 1;
  const wait = Math.min(Math.max(0, runAtMs - Date.now()), 2 ** 31 - 1);
  setTimeout(() => {
    mem.delayed -= 1;
    mem.pending.push({ id, payload, token: '', attempts: 0 });
  }, wait).unref();
  return id;
}

/** The timers above fire by themselves, so there is nothing to promote. */
export async function jobsPromoteDue(): Promise<number> {
  return 0;
}

/**
 * Chapter 4.8: the double-credit bug. Every call adds the amount and writes a ledger row, so a retried
 * delivery pays twice. `ref` carries the idempotency key but nothing ever looks at it. An unknown user has no
 * wallet row: nothing is credited and the balance reads 0.
 */
export async function walletCredit(
  deps: LearnerDeps,
  userId: string,
  amount: number,
  idempotencyKey: string,
): Promise<{ credited: boolean; balance: number }> {
  const { rows } = await deps.db.query(
    `WITH up AS (
       UPDATE wallets SET balance = balance + $2 WHERE user_id = $1 RETURNING user_id, balance
     ), led AS (
       INSERT INTO wallet_transactions (user_id, delta, reason, ref, created_at)
       SELECT user_id, $2::integer, 'contest_payout', $3::text, now() FROM up
     )
     SELECT balance FROM up`,
    [userId, amount, idempotencyKey],
  );
  const row = rows[0] as { balance: number } | undefined;
  return { credited: row !== undefined, balance: row ? Number(row.balance) : 0 };
}

/**
 * Chapter 4.10: check, then act. Between the GET and the DECR another request can run the same GET and
 * also see a slot, so with the counter at 1 several callers can win it. The level fixes it with a lock.
 */
export async function contestClaimLastSlot(deps: LearnerDeps, contestId: number): Promise<boolean> {
  const key = `contest:${contestId}:slots`;
  const left = Number(await deps.redis.get(key));
  if (left > 0) {
    await deps.redis.decr(key);
    return true;
  }
  return false;
}

/** Chapter 4.13: the expiry storm. Every key gets the same TTL, one round trip each, so they all die in the same second. */
export async function sessionsExpireWithJitter(
  deps: LearnerDeps,
  keys: string[],
  baseSeconds: number,
): Promise<number> {
  let n = 0;
  for (const key of keys) {
    if (await deps.redis.expire(key, baseSeconds)) n += 1;
  }
  return n;
}

/** Chapter 4.14: ask Postgres every time, even for names nobody has ever used. */
export async function usernameTaken(
  deps: LearnerDeps,
  name: string,
): Promise<{ taken: boolean; checkedDb: boolean }> {
  const { rows } = await deps.db.query('SELECT 1 FROM users WHERE handle = $1', [name]);
  return { taken: rows.length > 0, checkedDb: true };
}

/** Chapter 4.16: no ops wall without the learner's time series. The provided hook calls this for every request. */
export async function opsRecord(): Promise<null> {
  return null;
}

export async function opsRange(
  _deps: LearnerDeps,
  route: string,
): Promise<{ route: string; buckets: unknown[] }> {
  return { route, buckets: [] };
}

// ---- Chapter 4b "On call": planted faults. Every baseline below is wrong ON PURPOSE; the level asks the
// learner to name the problem under traffic before touching it. Do not "fix" them.

/** Where `oncall.lookupTeam` dials: the instance's current Redis URL (set at boot, follows target switches). */
let oncallRedisUrl: () => string = () => process.env.REDIS_URL ?? 'redis://localhost:6379';
let oncallLog: (obj: object, msg: string) => void = () => undefined;
export function configureOncall(opts: {
  redisUrl: () => string;
  log: (obj: object, msg: string) => void;
}): void {
  oncallRedisUrl = opts.redisUrl;
  oncallLog = opts.log;
}

/** FAULT: KEYS walks the whole keyspace in one blocking command. Fine on a laptop, a stall on a big keyspace. */
export async function oncallCountUsers(deps: LearnerDeps, prefix: string): Promise<number> {
  const keys = (await deps.redis.keys(`${prefix}*`)) as string[];
  return keys.length;
}

/** FAULT: the view key is written with no TTL, so every page view stays in memory for ever. */
export async function oncallRecordView(
  deps: LearnerDeps,
  userId: string,
  matchId: string,
): Promise<unknown> {
  await deps.redis.set(`view:${userId}:${matchId}`, new Date().toISOString());
  return { ok: true };
}

/** The repair the learner writes (SCAN + EXPIRE, pipelined). The baseline gives no key a TTL. */
export async function oncallAddTtls(): Promise<number> {
  return 0;
}

/** How long the planted Lua loop spins: `ONCALL_SPIN_MS`, default 20000, clamped to 1 ms .. 120 s. */
export function oncallSpinMs(env: NodeJS.ProcessEnv = process.env): number {
  const n = Number(env.ONCALL_SPIN_MS);
  return env.ONCALL_SPIN_MS !== undefined && env.ONCALL_SPIN_MS !== '' && Number.isFinite(n)
    ? Math.min(120_000, Math.max(1, Math.trunc(n)))
    : 20_000;
}

// Read-only on purpose: Redis can SCRIPT KILL a script only until its first write (digest, programmability).
// Bounded by os.clock() (CPU seconds, one of the few library calls the Redis Lua sandbox allows), so nothing
// hangs for ever even if nobody kills it. redis.call('TIME') cannot be the clock: inside a script Redis freezes
// it at the script's start (measured on redis 8.10.3), so a loop waiting on TIME never ends.
const BADGE_LOOP = `
local spinMs = tonumber(ARGV[1])
local start = os.clock()
while (os.clock() - start) * 1000 < spinMs do
end
return 'done'
`;

/**
 * FAULT: "recompute badges" as one EVAL whose loop blocks every other client of this Redis until it ends.
 * Note the app's learner Redis wrapper rejects after 2 s, so the route answers 500 long before the script ends;
 * the script keeps running inside Redis.
 */
export async function oncallRecomputeBadges(deps: LearnerDeps): Promise<unknown> {
  return deps.redis.eval(BADGE_LOOP, { keys: [], arguments: [String(oncallSpinMs())] });
}

type LeakClient = ReturnType<typeof createClient>;
const leaked: LeakClient[] = [];
let leakCapLoggedAt = 0;

/** Safety cap for the leak (a demo must not take the app or Redis down): 2000 clients, `ONCALL_LEAK_CAP` overrides in tests. */
function leakCap(): number {
  const n = Number(process.env.ONCALL_LEAK_CAP);
  return Number.isInteger(n) && n >= 1 ? n : 2000;
}

/** How many never-closed clients this instance holds (GET /app/oncall/status). 0 after a restart. */
export function oncallLeakedClients(): number {
  return leaked.length;
}

/** Shutdown and tests: close what the faulty baseline left open. */
export function closeOncallLeaks(): void {
  for (const c of leaked.splice(0)) {
    try {
      c.destroy();
    } catch {
      /* already closed */
    }
  }
}

/**
 * FAULT: a new Redis client per call, connected, used once and never closed. Every request adds a connection
 * (`INFO clients` connected_clients climbs) until the cap, when the oldest leaked client is closed and one line a
 * minute says so.
 */
export async function oncallLookupTeam(
  _deps: LearnerDeps,
  teamId: string,
): Promise<{ id: string; name: string } | null> {
  const client = createClient({ url: oncallRedisUrl(), socket: { connectTimeout: 3000 } });
  client.on('error', () => undefined); // a leaked client may outlive a Redis restart; never crash on it
  try {
    await client.connect();
  } catch (err) {
    try {
      client.destroy();
    } catch {
      /* never connected */
    }
    throw err;
  }
  leaked.push(client); // never closed: that is the fault
  if (leaked.length > leakCap()) {
    const oldest = leaked.shift()!;
    try {
      oldest.destroy();
    } catch {
      /* already closed */
    }
    const now = Date.now();
    if (now - leakCapLoggedAt > 60_000) {
      leakCapLoggedAt = now;
      oncallLog(
        { cap: leakCap() },
        'oncall.lookupTeam leak cap reached: closing the oldest leaked client',
      );
    }
  }
  const h = (await client.hGetAll(`team:${teamId}`)) as Record<string, string>;
  return h.id === undefined && h.name === undefined
    ? null
    : { id: h.id ?? teamId, name: h.name ?? '' };
}

/** The repair the learner writes (HSCAN, HSET into buckets, UNLINK). The baseline moves nothing. */
export async function oncallSplitBigKey(): Promise<{ fields: number; buckets: number }> {
  return { fields: 0, buckets: 0 };
}

/** Test hook: the in-process baselines keep state; tests reset it. */
export function resetBaselineState(): void {
  sessions.clear();
  windows.clear();
  mem.pending.length = 0;
  mem.processing.clear();
  mem.completed = 0;
  mem.failed = 0;
  mem.delayed = 0;
}
