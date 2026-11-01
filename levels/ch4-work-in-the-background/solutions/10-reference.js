// Reference: a lock around "look at the slots, take one".
//   lock:contest:<id>        the lock: SET NX PX with a random token, so only the holder can release it
//   contest:<id>:slots       how many slots are left      contest:<id>:members   who took one
// SET key token NX PX 5000 succeeds for exactly one caller. The expiry means a holder that dies cannot block everyone for ever.
// Callers that lose retry for a short while. Under the lock the read and the DECR cannot interleave with anyone else's.
// Release with compare-and-delete (a Lua script): only delete the lock if it still holds OUR token. A plain DEL could remove
// someone else's lock if ours had expired. On Redis 8.4 and later `DELEX key IFEQ token` does the same in one command; this
// game's Redis is 8.10, but the script works on every version.
import { randomBytes } from 'node:crypto';

const LOCK_MS = 5000; // longer than the critical section can take
const WAIT_MS = 2000; // how long a caller keeps trying before it gives up and answers false
const RELEASE = `if redis.call('GET', KEYS[1]) == ARGV[1] then return redis.call('DEL', KEYS[1]) end return 0`;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export default async function claimLastSlot({ redis }, contestId, userId) {
  const lock = `lock:contest:${contestId}`;
  const token = randomBytes(16).toString('hex');
  const deadline = Date.now() + WAIT_MS;

  for (;;) {
    const got = await redis.set(lock, token, { condition: 'NX', expiration: { type: 'PX', value: LOCK_MS } });
    if (got === 'OK') break;
    if (Date.now() >= deadline) return false;
    await sleep(5 + Math.random() * 15);
  }

  try {
    const slots = `contest:${contestId}:slots`;
    const left = Number(await redis.get(slots));
    if (!(left > 0)) return false;
    await redis.multi().decr(slots).sAdd(`contest:${contestId}:members`, userId).exec();
    return true;
  } finally {
    await redis.eval(RELEASE, { keys: [lock], arguments: [token] });
  }
}
