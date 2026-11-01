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
  const { rows } = await deps.db.query('UPDATE players SET name = name WHERE id = $1 RETURNING id', [playerId]);
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
  sessions.set(sid, { userId: user.id, name: user.display_name, createdAt: new Date().toISOString() });
  return sid;
}

export async function getSession(_deps: LearnerDeps, sid: string): Promise<unknown> {
  return sessions.get(sid) ?? null;
}

/** Chapter 3 leaderboard: ORDER BY over the unindexed contest_entries table on every read. */
export async function leaderboardTop(deps: LearnerDeps, contestId: number, limit: number): Promise<unknown> {
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
