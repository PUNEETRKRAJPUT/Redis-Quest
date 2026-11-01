// Reference for slot jobs.enqueue: the job-queue page's design (Redis docs, use-cases/job-queue).
//   queue:jobs:pending        list of job ids, LPUSH in, the oldest id is at the right
//   queue:jobs:job:<id>       hash: id payload status attempts enqueued_at_ms (claimed_at_ms claim_token later)
// One MULTI, so a job is never in the list without its hash.
import { randomBytes } from 'node:crypto';

export default async function enqueue({ redis }, payload) {
  const id = randomBytes(8).toString('hex');
  await redis
    .multi()
    .hSet(`queue:jobs:job:${id}`, {
      id,
      payload: JSON.stringify(payload),
      status: 'pending',
      attempts: '0',
      enqueued_at_ms: String(Date.now()),
    })
    .lPush('queue:jobs:pending', id)
    .exec();
  return id;
}
