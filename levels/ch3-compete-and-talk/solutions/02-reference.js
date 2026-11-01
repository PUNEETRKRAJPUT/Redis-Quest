// Reference: a fixed-window counter (redis.io use case "rate limiter", the INCR + EXPIRE variation).
// One string per user. INCR is atomic, so a hundred concurrent calls get a hundred different counts.
// The first call of a window (count 1) starts the 60 s clock; when the key expires the next call starts a new window.
const LIMIT = 10;
const WINDOW_SECONDS = 60;

export default async function allow({ redis }, userId) {
  const key = `ratelimit:fixed:${userId}`;
  const count = await redis.incr(key);
  if (count === 1) await redis.expire(key, WINDOW_SECONDS);
  // For a Retry-After header, `await redis.pTTL(key)` says how long the window has left.
  return count <= LIMIT;
}
