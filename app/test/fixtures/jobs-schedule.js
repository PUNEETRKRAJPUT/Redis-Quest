// Reference for slot jobs.schedule: a delayed job is a sorted set member scored by the time it should run.
//   queue:jobs:delayed   zset, member = job id, score = runAtMs
//   queue:jobs:job:<id>  the same hash as an immediate job, status `delayed`
import { randomBytes } from 'node:crypto';

export default async function schedule({ redis }, payload, runAtMs) {
  const id = randomBytes(8).toString('hex');
  await redis
    .multi()
    .hSet(`queue:jobs:job:${id}`, {
      id,
      payload: JSON.stringify(payload),
      status: 'delayed',
      attempts: '0',
      enqueued_at_ms: String(Date.now()),
      run_at_ms: String(runAtMs),
    })
    .zAdd('queue:jobs:delayed', { score: runAtMs, value: id })
    .exec();
  return id;
}
