// Reference: single-flight (redis.io cache-aside use case). One caller loads a missing key; the others
// poll the cache until it fills. The lock has a PX so a dead winner cannot block anyone for long, and
// is released only if the token is still ours, on every path.
import { randomUUID } from 'node:crypto';

const TTL_SECONDS = 30;
const LOCK_PX = 5000; // must be longer than the slowest Postgres read
const POLL_MS = 50;

const RELEASE = `if redis.call('GET', KEYS[1]) == ARGV[1] then return redis.call('DEL', KEYS[1]) end return 0`;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function readCache(redis, key) {
  const cached = await redis.hGetAll(key);
  return Object.keys(cached).length > 0 ? cached : null;
}

async function loadAndStore(redis, db, key, playerId) {
  const { rows } = await db.query('SELECT * FROM player_stats($1)', [playerId]);
  const row = rows[0];
  if (!row) return null;
  const fields = Object.fromEntries(
    Object.entries(row).map(([name, value]) => [name, value === null ? '' : String(value)]),
  );
  await redis.multi().hSet(key, fields).expire(key, TTL_SECONDS).exec();
  return row;
}

export default async function getPlayerStats({ redis, db }, playerId) {
  const key = `cache:player:${playerId}`;
  const lockKey = `lock:${key}`;

  const hit = await readCache(redis, key);
  if (hit) return hit;

  const token = randomUUID();
  const won = await redis.set(lockKey, token, { condition: 'NX', expiration: { type: 'PX', value: LOCK_PX } });

  if (won === 'OK') {
    try {
      // Another winner may have filled the cache between our miss and our lock.
      const again = await readCache(redis, key);
      if (again) return again;
      return await loadAndStore(redis, db, key, playerId);
    } finally {
      await redis.eval(RELEASE, { keys: [lockKey], arguments: [token] });
    }
  }

  // Not the winner: wait for the cache to fill, until the lock itself would have expired.
  const deadline = Date.now() + LOCK_PX;
  while (Date.now() < deadline) {
    await sleep(POLL_MS);
    const filled = await readCache(redis, key);
    if (filled) return filled;
    if (!(await redis.exists(lockKey))) break; // winner finished without filling it (not a player)
  }
  return loadAndStore(redis, db, key, playerId);
}
