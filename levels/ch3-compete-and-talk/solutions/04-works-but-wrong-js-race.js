// Works, but wrong: the same log, but trim, count and add are three separate commands from JavaScript. One request
// at a time it is exact. A hundred at once all count zero entries before any of them adds one, and all are allowed.
import { randomBytes } from 'node:crypto';

const LIMIT = 10;
const WINDOW_MS = 60_000;

export default async function allow({ redis }, userId) {
  const key = `ratelimit:log:${userId}`;
  const now = Date.now();
  await redis.zRemRangeByScore(key, 0, now - WINDOW_MS);
  const used = await redis.zCard(key);
  if (used >= LIMIT) return false;
  await redis.zAdd(key, { score: now, value: `${now}-${randomBytes(6).toString('hex')}` });
  await redis.pExpire(key, WINDOW_MS * 2);
  return true;
}
