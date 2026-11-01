// Works, but wrong: a correct token bucket when requests arrive one at a time. The state is read with HMGET, the
// maths happens in JavaScript, and the new state is written with HSET: three steps with a gap between them.
// A hundred concurrent calls all read "full bucket" before any of them writes, and all of them are allowed.
const CAPACITY = 10;
const REFILL_RATE = 1;
const REFILL_INTERVAL_MS = 60_000;

export default async function allow({ redis }, userId) {
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
