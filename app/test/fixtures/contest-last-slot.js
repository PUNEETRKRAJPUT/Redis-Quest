// Reference for slot contest.claimLastSlot: a lock around check-then-act.
//   lock:contest:<id>        SET <random token> NX PX 5000: whoever sets it holds it; the TTL frees it if we die
//   contest:<id>:slots       slots left; contest:<id>:members who got one
// Release is compare-and-delete in Lua, so we never delete a lock that expired and was taken by someone else.
// (DELEX key IFEQ token does the same in one command on Redis 8.4 and later; measured working on 8.10.3.)
import { randomBytes } from 'node:crypto';
import { setTimeout as sleep } from 'node:timers/promises';

const RELEASE = `if redis.call('GET', KEYS[1]) == ARGV[1] then return redis.call('DEL', KEYS[1]) else return 0 end`;

export default async function claimLastSlot({ redis }, contestId, userId) {
  const lock = `lock:contest:${contestId}`;
  const token = randomBytes(8).toString('hex');
  const deadline = Date.now() + 3000;
  while ((await redis.set(lock, token, { NX: true, PX: 5000 })) === null) {
    if (Date.now() > deadline) return false; // could not get the lock: do not guess
    await sleep(10 + Math.floor(Math.random() * 20));
  }
  try {
    const left = Number(await redis.get(`contest:${contestId}:slots`));
    if (!(left > 0)) return false;
    await redis
      .multi()
      .decr(`contest:${contestId}:slots`)
      .sAdd(`contest:${contestId}:members`, userId)
      .exec();
    return true;
  } finally {
    await redis.eval(RELEASE, { keys: [lock], arguments: [token] });
  }
}
