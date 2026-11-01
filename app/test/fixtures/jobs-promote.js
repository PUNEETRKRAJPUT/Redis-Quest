// Reference for slot jobs.promoteDue: move due jobs from delayed to pending. It is one Lua script on purpose:
// ZRANGE then ZREM then LPUSH from JavaScript lets two promoters (two instances) read the same due ids and push
// them twice. Inside a script nothing else runs between the steps. (It touches the job hash through a key it
// builds from a prefix argument, which is fine on one node and not on a cluster.)
const SCRIPT = `
local ids = redis.call('ZRANGE', KEYS[1], '-inf', ARGV[1], 'BYSCORE', 'LIMIT', 0, 100)
for _, id in ipairs(ids) do
  redis.call('ZREM', KEYS[1], id)
  redis.call('LPUSH', KEYS[2], id)
  redis.call('HSET', ARGV[2] .. id, 'status', 'pending')
end
return #ids
`;

export default async function promoteDue({ redis }, nowMs) {
  let total = 0;
  for (;;) {
    const n = await redis.eval(SCRIPT, {
      keys: ['queue:jobs:delayed', 'queue:jobs:pending'],
      arguments: [String(nowMs), 'queue:jobs:job:'],
    });
    total += n;
    if (n < 100) return total;
  }
}
