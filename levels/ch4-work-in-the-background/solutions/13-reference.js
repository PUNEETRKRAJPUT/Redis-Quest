// Reference: every key gets base + a random 0..jitter seconds, so the deadlines are spread instead of all landing together.
// One pipeline carries all the EXPIRE commands in a single round trip. EXPIRE answers 1 when it set a TTL, 0 when the key is missing.
export default async function expireWithJitter({ redis }, keys, baseSeconds, jitterSeconds) {
  const pipeline = redis.multi();
  for (const key of keys) {
    pipeline.expire(key, baseSeconds + Math.floor(Math.random() * (jitterSeconds + 1)));
  }
  const replies = await pipeline.execAsPipeline();
  return replies.filter((reply) => Number(reply) === 1).length;
}
