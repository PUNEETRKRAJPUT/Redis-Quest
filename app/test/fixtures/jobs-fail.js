// Reference for slot jobs.fail: same fencing as complete. Below maxAttempts the job goes back to pending for
// another try; at maxAttempts it is moved to the capped `failed` list. `attempts` was incremented at claim time.
const SCRIPT = `
if redis.call('HGET', KEYS[1], 'status') ~= 'processing' or redis.call('HGET', KEYS[1], 'claim_token') ~= ARGV[2] then
  return 0
end
redis.call('LREM', KEYS[2], 1, ARGV[1])
redis.call('HSET', KEYS[1], 'last_error', ARGV[3])
if tonumber(redis.call('HGET', KEYS[1], 'attempts')) >= tonumber(ARGV[4]) then
  redis.call('HSET', KEYS[1], 'status', 'failed')
  redis.call('LPUSH', KEYS[4], ARGV[1])
  redis.call('LTRIM', KEYS[4], 0, 49)
  redis.call('EXPIRE', KEYS[1], 86400)
  return 'failed'
end
redis.call('HSET', KEYS[1], 'status', 'pending')
redis.call('LPUSH', KEYS[3], ARGV[1])
return 'retry'
`;

export default async function fail({ redis }, id, token, error, maxAttempts) {
  const out = await redis.eval(SCRIPT, {
    keys: [
      `queue:jobs:job:${id}`,
      'queue:jobs:processing',
      'queue:jobs:pending',
      'queue:jobs:failed',
    ],
    arguments: [id, token, String(error), String(maxAttempts)],
  });
  return out === 'retry' || out === 'failed' ? out : false;
}
