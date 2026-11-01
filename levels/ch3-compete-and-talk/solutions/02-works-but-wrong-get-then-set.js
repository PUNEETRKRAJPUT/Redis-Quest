// Works, but wrong: the count is in Redis and the window expires, but the read and the write are two commands
// from JavaScript. One request at a time it is exact. A hundred at once all read the same count, all write the
// same count plus one, and all of them are allowed.
const LIMIT = 10;
const WINDOW_SECONDS = 60;

export default async function allow({ redis }, userId) {
  const key = `ratelimit:fixed:${userId}`;
  const count = Number((await redis.get(key)) ?? 0) + 1;
  await redis.set(key, String(count), { expiration: { type: 'EX', value: WINDOW_SECONDS } });
  return count <= LIMIT;
}
