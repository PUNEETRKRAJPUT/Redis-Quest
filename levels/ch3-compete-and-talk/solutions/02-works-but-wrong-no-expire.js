// Works, but wrong: INCR is atomic and the counting is right, but nothing ever starts the 60 s clock. The count
// never resets: after ten requests a user is blocked for good, and every user ever seen stays in Redis forever.
const LIMIT = 10;

export default async function allow({ redis }, userId) {
  const count = await redis.incr(`ratelimit:fixed:${userId}`);
  return count <= LIMIT;
}
