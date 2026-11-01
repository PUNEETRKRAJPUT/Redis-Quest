// Reference bundle: delayed jobs. Default export = schedule (the first slot), named exports = the slot names after the dot.
//   queue:jobs:delayed   sorted set: member = job id, score = the time to run it (epoch ms)
//   queue:jobs:pending   the list the workers already take from
// schedule stores the job and adds its id to the delayed set. promoteDue moves everything whose score is at or below now to
// pending, in one Lua script: with a script, two promoters running at once cannot both move the same job.
import { randomBytes } from 'node:crypto';

const DELAYED = 'queue:jobs:delayed';
const PENDING = 'queue:jobs:pending';
const JOB_PREFIX = 'queue:jobs:job:';

const PROMOTE = `
local due = redis.call('ZRANGE', KEYS[1], '-inf', ARGV[1], 'BYSCORE', 'LIMIT', 0, 100)
for _, id in ipairs(due) do
  redis.call('ZREM', KEYS[1], id)
  redis.call('LPUSH', KEYS[2], id)
  redis.call('HSET', ARGV[2] .. id, 'status', 'pending')
end
return #due`;

export async function schedule({ redis }, payload, runAtMs) {
  const id = randomBytes(8).toString('hex');
  await redis
    .multi()
    .hSet(`${JOB_PREFIX}${id}`, {
      id,
      payload: JSON.stringify(payload),
      status: 'delayed',
      attempts: '0',
      enqueued_at_ms: String(Date.now()),
    })
    .zAdd(DELAYED, { score: runAtMs, value: id })
    .exec();
  return id;
}

export async function promoteDue({ redis }, nowMs) {
  return redis.eval(PROMOTE, { keys: [DELAYED, PENDING], arguments: [String(nowMs), JOB_PREFIX] });
}

export default schedule;
