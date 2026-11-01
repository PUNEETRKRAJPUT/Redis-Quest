// Wrong: publishes, and keeps the last ball, but on the channel score:m-041 instead of score:match:m-041. Nobody
// subscribes to that name. PUBLISH does not complain: it answers 0 receivers, and the ticker stays silent.
const LAST_TTL_SECONDS = 3600;

export default async function publish({ redis }, matchId, ball) {
  const json = JSON.stringify({ ...ball, matchId });
  await redis.set(`score:match:${matchId}:last`, json, { expiration: { type: 'EX', value: LAST_TTL_SECONDS } });
  return redis.publish(`score:${matchId}`, json);
}
