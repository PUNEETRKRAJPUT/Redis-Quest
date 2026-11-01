// Reference for level 6: the contest leaderboard lives in one sorted set per contest, lb:contest:<contestId>
// (member = team id, score = points). All three functions are in this one file so the design reads top to bottom.
// In your workspace each lives in its own file as the default export:
//   top        -> ch3/leaderboard.js        (deps, contestId, limit)
//   addPoints  -> ch3/leaderboard-add.js    (deps, contestId, teamId, delta)
//   rank       -> ch3/leaderboard-rank.js   (deps, contestId, teamId)
// The default export below is top, so this file also works as ch3/leaderboard.js on its own.
const boardKey = (contestId) => `lb:contest:${contestId}`;

// Best first. ZRANGE ... REV 0 limit-1 asks Redis for exactly the rows the page shows, never the whole board.
export async function top({ redis }, contestId, limit) {
  const rows = await redis.zRangeWithScores(boardKey(contestId), 0, limit - 1, { REV: true });
  return rows.map((r) => ({ teamId: r.value, points: r.score }));
}

// ZINCRBY adds inside Redis in one step. It would also create a member that is not on the board, and the
// contract says null for a team that is not in the contest, so look first.
export async function addPoints({ redis }, contestId, teamId, delta) {
  const key = boardKey(contestId);
  if ((await redis.zScore(key, teamId)) === null) return null;
  return redis.zIncrBy(key, delta, teamId);
}

// ZREVRANK is the position from the top (0 is the leader). The "around" window is a second ZRANGE REV on the
// same sorted set: two above, the team, two below.
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
