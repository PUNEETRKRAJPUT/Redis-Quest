// Wrong: the same TTL for every key. Keys written in the same second still expire in the same second: the storm.
export default async function expireWithJitter({ redis }, keys, baseSeconds) {
  const pipeline = redis.multi();
  for (const key of keys) pipeline.expire(key, baseSeconds);
  const replies = await pipeline.execAsPipeline();
  return replies.filter((reply) => Number(reply) === 1).length;
}
