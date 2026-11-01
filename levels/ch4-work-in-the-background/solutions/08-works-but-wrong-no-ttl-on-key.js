// Works, but wrong: the credit happens once per key, but the marker never expires. Every award ever made leaves an
// idem:<key> string in Redis for good.
const CREDIT = `
if redis.call('SET', KEYS[1], '1', 'NX') then
  redis.call('INCRBY', KEYS[2], tonumber(ARGV[1]))
  return {1, tonumber(redis.call('GET', KEYS[2]))}
end
return {0, tonumber(redis.call('GET', KEYS[2]) or 0)}`;

export default async function credit({ redis }, userId, amount, idempotencyKey) {
  const [done, balance] = await redis.eval(CREDIT, {
    keys: [`idem:${idempotencyKey}`, `wallet:${userId}`],
    arguments: [String(amount)],
  });
  return { credited: done === 1, balance };
}
