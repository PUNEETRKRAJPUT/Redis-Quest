// Wrong: the log is written, but entries are never removed when they fall out of the window. It counts every
// request ever made, so a user with ten old entries (the check seeds ten, long expired) is refused for good.
import { randomBytes } from 'node:crypto';

const LIMIT = 10;

const SCRIPT = `
if redis.call('ZCARD', KEYS[1]) < tonumber(ARGV[2]) then
  redis.call('ZADD', KEYS[1], ARGV[1], ARGV[3])
  redis.call('PEXPIRE', KEYS[1], 120000)
  return 1
end
return 0
`;

export default async function allow({ redis }, userId) {
  const now = Date.now();
  const allowed = await redis.sendCommand([
    'EVAL',
    SCRIPT,
    '1',
    `ratelimit:log:${userId}`,
    String(now),
    String(LIMIT),
    `${now}-${randomBytes(6).toString('hex')}`,
  ]);
  return allowed === 1;
}
