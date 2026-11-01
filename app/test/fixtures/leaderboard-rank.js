// Reference for slot leaderboard.rank: ZREVRANK for the position, then a window of two above and two below.
export default async function rank({ redis }, contestId, teamId) {
  const key = `lb:contest:${contestId}`;
  const pos = await redis.zRevRank(key, teamId); // 0-based, best first
  if (pos === null) return null;
  const from = Math.max(0, pos - 2);
  const rows = await redis.zRangeWithScores(key, from, pos + 2, { REV: true });
  const around = rows.map((r) => ({ teamId: r.value, score: r.score }));
  const mine = around.find((e) => e.teamId === teamId);
  return { rank: pos + 1, score: mine.score, around };
}
