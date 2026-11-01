// Reference for slot jobs.complete: a Lua script, so "is this still my job?" and "mark it done" are one step.
// The status check matters as much as the token: after a retry or a reclaim the old token still sits in the
// hash, and only the status says the old claim is dead. 0 = not the owner (fenced).
const SCRIPT = `
if redis.call('HGET', KEYS[1], 'status') ~= 'processing' or redis.call('HGET', KEYS[1], 'claim_token') ~= ARGV[2] then
  return 0
end
redis.call('LREM', KEYS[2], 1, ARGV[1])
redis.call('HSET', KEYS[1], 'status', 'completed', 'completed_at_ms', ARGV[3], 'result', ARGV[4])
redis.call('LPUSH', KEYS[3], ARGV[1])
redis.call('LTRIM', KEYS[3], 0, 49)
redis.call('EXPIRE', KEYS[1], 86400)
return 1
`;

export default async function complete({ redis }, id, token, result) {
  const done = await redis.eval(SCRIPT, {
    keys: [`queue:jobs:job:${id}`, 'queue:jobs:processing', 'queue:jobs:completed'],
    arguments: [id, token, String(Date.now()), JSON.stringify(result ?? null)],
  });
  return done === 1;
}
