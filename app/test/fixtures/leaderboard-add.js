// Reference for slot leaderboard.addPoints (used by scripts/check/A-02.sh): ZINCRBY on a sorted set per contest.
// The score is the new total; null when the team is not on the board (the route answers 404).
export default async function addPoints({ redis }, contestId, teamId, delta) {
  const key = `lb:contest:${contestId}`;
  if ((await redis.zScore(key, teamId)) === null) return null; // ZINCRBY would create the member
  return redis.zIncrBy(key, delta, teamId);
}
