// Wrong: promoteDue moves every delayed job, whatever its run time. A reminder meant for next week goes out now.
import { randomBytes } from 'node:crypto';

const DELAYED = 'queue:jobs:delayed';
const PENDING = 'queue:jobs:pending';
const JOB_PREFIX = 'queue:jobs:job:';

const PROMOTE = `
local due = redis.call('ZRANGE', KEYS[1], 0, -1)
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
