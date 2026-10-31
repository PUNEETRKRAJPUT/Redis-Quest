// Works, but wrong: the token bucket maths is right, but the read (HMGET) and the write (HSET)
// are separate round trips. Under concurrency many calls read the same token count and all pass.
const CAPACITY = 10;
const REFILL_RATE = 1;
const REFILL_INTERVAL_MS = 60_000;

export default async function allow({ redis }, userId) {
  const key = `ratelimit:${userId}`;
  const now = Date.now();
  const [rawTokens, rawLast] = await redis.sendCommand(['HMGET', key, 'tokens', 'last_refill']);
  let tokens = rawTokens === null ? CAPACITY : Number(rawTokens);
  let lastRefill = rawLast === null ? now : Number(rawLast);

  const refills = Math.floor((now - lastRefill) / REFILL_INTERVAL_MS);
  if (refills > 0) {
    tokens = Math.min(CAPACITY, tokens + refills * REFILL_RATE);
    lastRefill += refills * REFILL_INTERVAL_MS;
  }
  const allowed = tokens >= 1;
  if (allowed) tokens -= 1;
  await redis.sendCommand(['HSET', key, 'tokens', String(tokens), 'last_refill', String(lastRefill)]);
  return allowed;
}
