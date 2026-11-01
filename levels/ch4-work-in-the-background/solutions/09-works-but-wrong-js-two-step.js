// Works, but wrong: promoteDue reads the due ids and then moves them with separate commands from JavaScript. With one promoter
// it is right. With two promoters running at once both read the same due ids before either removes them, and each job is
// pushed to pending once per promoter: jobs run twice.
import { randomBytes } from 'node:crypto';

const DELAYED = 'queue:jobs:delayed';
const PENDING = 'queue:jobs:pending';
const JOB_PREFIX = 'queue:jobs:job:';

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
  // Read the due ids, then move each one with separate commands. Correct for one promoter at a time.
  const due = await redis.zRange(DELAYED, '-inf', String(nowMs), { BY: 'SCORE', LIMIT: { offset: 0, count: 100 } });
  for (const id of due) {
    await redis.zRem(DELAYED, id);
    await redis.lPush(PENDING, id);
    await redis.hSet(`${JOB_PREFIX}${id}`, 'status', 'pending');
  }
  return due.length;
}

export default schedule;
