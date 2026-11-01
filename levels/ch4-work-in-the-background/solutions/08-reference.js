// Reference: credit once per idempotency key, in one Lua script.
//   idem:<key>        a marker that this key has been used, SET NX with an expiry (a day here)
//   wallet:<userId>   the points balance
// SET ... NX only succeeds for the first caller with a key. The marker and the INCRBY must happen together: if they were two
// commands from JavaScript, a crash between them would record "done" without crediting, and the credit would be lost for good.
// A script runs as one step, so both happen or neither does. The balance comes back in the same reply.
const CREDIT = `
if redis.call('SET', KEYS[1], '1', 'NX', 'EX', tonumber(ARGV[2])) then
  redis.call('INCRBY', KEYS[2], tonumber(ARGV[1]))
  return {1, tonumber(redis.call('GET', KEYS[2]))}
end
return {0, tonumber(redis.call('GET', KEYS[2]) or 0)}`;

const KEY_SECONDS = 86400;

export default async function credit({ redis }, userId, amount, idempotencyKey) {
  const [done, balance] = await redis.eval(CREDIT, {
    keys: [`idem:${idempotencyKey}`, `wallet:${userId}`],
    arguments: [String(amount), String(KEY_SECONDS)],
  });
  return { credited: done === 1, balance };
}
