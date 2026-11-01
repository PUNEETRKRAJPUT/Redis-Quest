// Reference: a sliding-window log (redis.io rate-limiter use case, "sliding window log").
// One sorted set per user: member = one allowed request (unique), score = when it happened in milliseconds.
// The trim, the count and the add run as one Lua script, so concurrent calls cannot slip past the limit together.
import { randomBytes } from 'node:crypto';

const LIMIT = 10;
const WINDOW_MS = 60_000;

const SCRIPT = `
local key = KEYS[1]
local now = tonumber(ARGV[1])
local window = tonumber(ARGV[2])
local limit = tonumber(ARGV[3])
local member = ARGV[4]

redis.call('ZREMRANGEBYSCORE', key, 0, now - window)
if redis.call('ZCARD', key) < limit then
  redis.call('ZADD', key, now, member)
  redis.call('PEXPIRE', key, window * 2)
  return 1
end
return 0
`;

export default async function allow({ redis }, userId) {
  const now = Date.now();
  // The member has to be unique, or two requests in the same millisecond would count as one entry.
  const member = `${now}-${randomBytes(6).toString('hex')}`;
  const allowed = await redis.sendCommand([
    'EVAL',
    SCRIPT,
    '1',
    `ratelimit:log:${userId}`,
    String(now),
    String(WINDOW_MS),
    String(LIMIT),
    member,
  ]);
  return allowed === 1;
}
