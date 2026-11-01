// Wrong: the leaderboard asks Postgres, which is what the app does before you touch it. contest_entries holds
// nothing for contest 9001 (the board for this level lives in Redis), so top comes back empty, and under load every
// page view would be a query: a leaderboard that is a database query has not moved. addPoints and rank are the
// Redis ones, so the failing part is top alone.
// In your workspace each function is its own file; this bundle's default export is top.
const boardKey = (contestId) => `lb:contest:${contestId}`;

export async function top({ db }, contestId, limit) {
  const { rows } = await db.query(
    `SELECT fantasy_team_id, points FROM contest_entries
      WHERE contest_id = $1 ORDER BY points DESC, id LIMIT $2`,
    [contestId, limit],
  );
  return rows.map((r) => ({ teamId: String(r.fantasy_team_id), points: Number(r.points) }));
}

export async function addPoints({ redis }, contestId, teamId, delta) {
  const key = boardKey(contestId);
  if ((await redis.zScore(key, teamId)) === null) return null;
  return redis.zIncrBy(key, delta, teamId);
}

export async function rank({ redis }, contestId, teamId) {
  const key = boardKey(contestId);
  const pos = await redis.zRevRank(key, teamId);
  if (pos === null) return null;
  const rows = await redis.zRangeWithScores(key, Math.max(0, pos - 2), pos + 2, { REV: true });
  const around = rows.map((r) => ({ teamId: r.value, score: r.score }));
  const mine = around.find((e) => e.teamId === teamId);
  return { rank: pos + 1, score: mine.score, around };
}

export default top;
