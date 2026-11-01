// Reference for slot wallet.credit: at-least-once delivery plus an idempotency key gives "once".
//   idem:<key>      SET ... NX EX 86400: only the first caller gets to set it
//   wallet:<user>   the balance, a plain string; INCRBY only when the key was set
// The two steps are one Lua script so a crash between them cannot leave a key without a credit (or a credit
// that a retry would repeat). The key expires after a day, long enough for any retry.
const SCRIPT = `
if redis.call('SET', KEYS[1], '1', 'NX', 'EX', ARGV[2]) then
  return { 1, redis.call('INCRBY', KEYS[2], ARGV[1]) }
end
return { 0, tonumber(redis.call('GET', KEYS[2]) or '0') }
`;

export default async function credit({ redis }, userId, amount, idempotencyKey) {
  const [credited, balance] = await redis.eval(SCRIPT, {
    keys: [`idem:${idempotencyKey}`, `wallet:${userId}`],
    arguments: [String(amount), '86400'],
  });
  return { credited: credited === 1, balance: Number(balance) };
}
