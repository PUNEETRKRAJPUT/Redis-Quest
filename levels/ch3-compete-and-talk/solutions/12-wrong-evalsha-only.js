// Wrong: level 3's token bucket, untouched: a Lua script run with SCRIPT LOAD and EVALSHA. It behaves, but there is no
// library named limiter in Redis, so nothing persists: after a restart the script cache is empty and every call pays
// the NOSCRIPT fallback. The level asks for a Function (FUNCTION LOAD, FCALL).
// (The rest of this file is the level 3 reference.)
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

let sha = null;

async function runScript(redis, key, args) {
  if (sha === null) sha = await redis.sendCommand(['SCRIPT', 'LOAD', SCRIPT]);
  try {
    return await redis.sendCommand(['EVALSHA', sha, '1', key, ...args]);
  } catch (err) {
    if (!String(err && err.message).includes('NOSCRIPT')) throw err;
    return redis.sendCommand(['EVAL', SCRIPT, '1', key, ...args]);
  }
}

export default async function allow({ redis }, userId) {
  const allowed = await runScript(redis, `ratelimit:${userId}`, [
    String(CAPACITY),
    String(REFILL_RATE),
    String(REFILL_INTERVAL_MS),
    String(Date.now()),
  ]);
  return allowed === 1;
}
