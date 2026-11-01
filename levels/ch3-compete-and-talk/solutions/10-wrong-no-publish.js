// Wrong: the last ball is kept in a key, but nothing is ever published. A phone that opens the page gets the last
// ball. Every phone that is already watching hears nothing, and the app's subscriber receives zero messages.
const LAST_TTL_SECONDS = 3600;

export default async function publish({ redis }, matchId, ball) {
  const json = JSON.stringify({ ...ball, matchId });
  await redis.set(`score:match:${matchId}:last`, json, { expiration: { type: 'EX', value: LAST_TTL_SECONDS } });
  return 0;
}
