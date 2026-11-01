// Reference for slot sessions.expireWithJitter: base + a random 0..jitter seconds per key, all in one pipeline
// (one round trip instead of one per key). Keys that all die in the same second make Redis do all that work in
// the same moment and send every client back to the database in the same moment.
export default async function expireWithJitter({ redis }, keys, baseSeconds, jitterSeconds) {
  const m = redis.multi();
  for (const key of keys)
    m.expire(key, baseSeconds + Math.floor(Math.random() * (jitterSeconds + 1)));
  const replies = await m.execAsPipeline();
  return replies.filter(Boolean).length;
}
