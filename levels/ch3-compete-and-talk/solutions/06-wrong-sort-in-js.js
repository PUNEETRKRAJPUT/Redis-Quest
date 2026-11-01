// Wrong: the board is in Redis, but top and rank pull the whole sorted set (ZRANGE 0 -1 WITHSCORES, forty thousand
// members) into JavaScript and sort it there. One request at a time every answer is right. A hundred connections
// each moving forty thousand members per page view is the load test's p99 failing, which is the only way this one is
// caught: the behavior checks pass. addPoints is the Redis one.
// In your workspace each function is its own file; this bundle's default export is top.
const boardKey = (contestId) => `lb:contest:${contestId}`;

async function everyone(redis, contestId) {
  const rows = await redis.zRangeWithScores(boardKey(contestId), 0, -1);
  return rows.sort((a, b) => b.score - a.score || (a.value < b.value ? 1 : -1));
}

export async function top({ redis }, contestId, limit) {
  const rows = await everyone(redis, contestId);
  return rows.slice(0, limit).map((r) => ({ teamId: r.value, points: r.score }));
}

export async function addPoints({ redis }, contestId, teamId, delta) {
  const key = boardKey(contestId);
  if ((await redis.zScore(key, teamId)) === null) return null;
  return redis.zIncrBy(key, delta, teamId);
}

export async function rank({ redis }, contestId, teamId) {
  const rows = await everyone(redis, contestId);
  const pos = rows.findIndex((r) => r.value === teamId);
  if (pos === -1) return null;
  const around = rows.slice(Math.max(0, pos - 2), pos + 3).map((r) => ({ teamId: r.value, score: r.score }));
  return { rank: pos + 1, score: rows[pos].score, around };
}

export default top;
