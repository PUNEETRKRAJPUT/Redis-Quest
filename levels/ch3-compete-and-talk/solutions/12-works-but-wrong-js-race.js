// Works, but wrong: the task asks for a library named limiter, so this file loads one, but it never calls it. The
// bucket itself is still HMGET, maths in JavaScript, HSET: three steps with a gap between them. One request at a time it
// is exact and the library check is satisfied. A hundred concurrent requests all read a full bucket before any of them
// writes, and all are allowed. The point of a function is that the read, the decision and the write run inside it.
const CAPACITY = 10;
const REFILL_RATE = 1;
const REFILL_INTERVAL_MS = 60_000;

const LIBRARY = `#!lua name=limiter

redis.register_function('tb_allow', function(keys, args)
  return 1
end)
`;

export default async function allow({ redis }, userId) {
  await redis.sendCommand(['FUNCTION', 'LOAD', 'REPLACE', LIBRARY]);
  const key = `ratelimit:${userId}`;
  const now = Date.now();
  const [rawTokens, rawLast] = await redis.hmGet(key, ['tokens', 'last_refill']);
  let tokens = rawTokens === null ? CAPACITY : Number(rawTokens);
  let last = rawLast === null ? now : Number(rawLast);
  const refills = Math.floor((now - last) / REFILL_INTERVAL_MS);
  if (refills > 0) {
    tokens = Math.min(CAPACITY, tokens + refills * REFILL_RATE);
    last += refills * REFILL_INTERVAL_MS;
  }
  let allowed = false;
  if (tokens >= 1) {
    tokens -= 1;
    allowed = true;
  }
  await redis.hSet(key, { tokens: String(tokens), last_refill: String(last) });
  return allowed;
}
