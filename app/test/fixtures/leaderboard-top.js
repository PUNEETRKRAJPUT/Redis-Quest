// Reference for slot leaderboard.top (copied to workspace/ch3/leaderboard.js by scripts/check/A-02.sh):
// top N of the sorted set, best first. Same entry shape as the baseline minus userId.
export default async function top({ redis }, contestId, limit) {
  const rows = await redis.zRangeWithScores(`lb:contest:${contestId}`, 0, limit - 1, { REV: true });
  return rows.map((r) => ({ teamId: r.value, points: r.score }));
}
