// Reference for slot jobs.reclaim: the visibility timeout. A job whose claimed_at_ms is older than visibilityMs
// belongs to a worker we assume is dead, so it goes back to pending. Someone has to run this on a schedule.
// A job whose worker died between BLMOVE and writing claimed_at_ms has no claimed_at_ms: judge it by
// enqueued_at_ms and wait twice as long. The move itself is a script that re-checks the token, so a worker that
// completes at the last moment is not undone.
const SCRIPT = `
if redis.call('HGET', KEYS[1], 'status') ~= 'processing' or (redis.call('HGET', KEYS[1], 'claim_token') or '') ~= ARGV[2] then
  return 0
end
redis.call('LREM', KEYS[2], 1, ARGV[1])
redis.call('HSET', KEYS[1], 'status', 'pending')
redis.call('HDEL', KEYS[1], 'claim_token')
redis.call('RPUSH', KEYS[3], ARGV[1])
return 1
`;

export default async function reclaim({ redis }, visibilityMs) {
  const now = Date.now();
  let moved = 0;
  for (const id of await redis.lRange('queue:jobs:processing', 0, -1)) {
    const job = await redis.hGetAll(`queue:jobs:job:${id}`);
    const claimedAt = Number(job.claimed_at_ms);
    const stale = claimedAt
      ? now - claimedAt >= visibilityMs
      : now - Number(job.enqueued_at_ms || 0) >= 2 * visibilityMs;
    if (!stale) continue;
    // RPUSH: the right end is where BLMOVE reads, so a rescued job is the next one taken.
    const n = await redis.eval(SCRIPT, {
      keys: [`queue:jobs:job:${id}`, 'queue:jobs:processing', 'queue:jobs:pending'],
      arguments: [id, job.claim_token ?? ''],
    });
    moved += n;
  }
  return moved;
}
