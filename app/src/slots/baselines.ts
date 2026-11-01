import { randomBytes } from 'node:crypto';
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

/** Test hook: the in-process baselines keep state; tests reset it. */
export function resetBaselineState(): void {
  sessions.clear();
  windows.clear();
}
