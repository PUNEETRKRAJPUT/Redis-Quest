// Reference: token bucket in one Lua script (redis.io use case "rate limiter").
// The whole read-decide-update runs atomically on the server, so concurrent calls cannot double-spend.
const CAPACITY = 10;
const REFILL_RATE = 1;
const REFILL_INTERVAL_MS = 60_000;

const SCRIPT = `
local key = KEYS[1]
local capacity = tonumber(ARGV[1])
local refill_rate = tonumber(ARGV[2])
local refill_interval = tonumber(ARGV[3])
local now = tonumber(ARGV[4])

local state = redis.call('HMGET', key, 'tokens', 'last_refill')
local tokens = tonumber(state[1])
local last_refill = tonumber(state[2])
if tokens == nil then
  tokens = capacity
  last_refill = now
end

local refills = math.floor((now - last_refill) / refill_interval)
if refills > 0 then
  tokens = math.min(capacity, tokens + refills * refill_rate)
  last_refill = last_refill + refills * refill_interval
end

local allowed = 0
if tokens >= 1 then
  tokens = tokens - 1
  allowed = 1
end
redis.call('HSET', key, 'tokens', tokens, 'last_refill', last_refill)
return allowed
`;

export default async function allow({ redis }, userId) {
  const key = `ratelimit:${userId}`;
  const allowed = await redis.sendCommand([
    'EVAL', SCRIPT, '1', key,
    String(CAPACITY), String(REFILL_RATE), String(REFILL_INTERVAL_MS), String(Date.now()),
  ]);
  return allowed === 1;
}
