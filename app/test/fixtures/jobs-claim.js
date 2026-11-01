// Reference for slot jobs.claim: BLMOVE pending -> processing is one atomic step, so a worker that dies right
// after it leaves the id in `processing` (the reclaimer finds it) instead of losing it, as RPOP would.
// BLMOVE holds its connection for up to the timeout, so it runs on a duplicate(): on the shared client every
// other request in this process would queue behind it. A duplicate starts closed (connect() it); the app closes it.
// Each claim gets a random token; complete and fail must present it (fencing).
import { randomBytes } from 'node:crypto';

export default async function claim({ redis }, worker, timeoutMs) {
  const conn = redis.duplicate();
  await conn.connect();
  const id =
    timeoutMs > 0
      ? await conn.blMove(
          'queue:jobs:pending',
          'queue:jobs:processing',
          'RIGHT',
          'LEFT',
          timeoutMs / 1000,
        )
      : await conn.lMove('queue:jobs:pending', 'queue:jobs:processing', 'RIGHT', 'LEFT');
  if (!id) return null;
  const key = `queue:jobs:job:${id}`;
  const token = randomBytes(8).toString('hex');
  const [, attempts, job] = await redis
    .multi()
    .hSet(key, {
      status: 'processing',
      claimed_at_ms: String(Date.now()),
      claim_token: token,
      worker,
    })
    .hIncrBy(key, 'attempts', 1)
    .hGetAll(key)
    .exec();
  return { id, payload: JSON.parse(job.payload), token, attempts: Number(attempts) };
}
