// Reference: the token bucket from level 3, now a Redis Function.
// A function is a library: FUNCTION LOAD stores it in Redis itself, where it persists and replicates with the data,
// and FCALL runs it by name. Nothing is in a script cache that a restart can empty.
// The library is loaded lazily: this module has no connection until it is called, so the first FCALL that answers
// "Function not found" loads the library (FUNCTION LOAD REPLACE) and tries once more. Loading is idempotent.
const CAPACITY = 10;
const REFILL_RATE = 1;
const REFILL_INTERVAL_MS = 60_000;

const LIBRARY = `#!lua name=limiter

redis.register_function('tb_allow', function(keys, args)
  local key = keys[1]
  local capacity = tonumber(args[1])
  local refill_rate = tonumber(args[2])
  local refill_interval = tonumber(args[3])
  local now = tonumber(args[4])

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
end)
`;

export default async function allow({ redis }, userId) {
  const call = () =>
    redis.sendCommand([
      'FCALL',
      'tb_allow',
      '1',
      `ratelimit:${userId}`,
      String(CAPACITY),
      String(REFILL_RATE),
      String(REFILL_INTERVAL_MS),
      String(Date.now()),
    ]);
  let allowed;
  try {
    allowed = await call();
  } catch (err) {
    if (!String(err && err.message).includes('Function not found')) throw err;
    await redis.sendCommand(['FUNCTION', 'LOAD', 'REPLACE', LIBRARY]);
    allowed = await call();
  }
  return allowed === 1;
}
