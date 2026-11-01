// Works, but wrong: the negative cache is right in every way except its lifetime. "Not found" is kept as long
// as a real row (30 s), so a player who signs up now stays invisible for half a minute.
import { randomUUID } from 'node:crypto';

const TTL_SECONDS = 30;
const MISSING_TTL_SECONDS = 30; // the same as a real row: a player who signs up tomorrow stays hidden
const MISSING_FIELD = '_missing';
const LOCK_PX = 5000; // must be longer than the slowest Postgres read
const POLL_MS = 50;

const RELEASE = `if redis.call('GET', KEYS[1]) == ARGV[1] then return redis.call('DEL', KEYS[1]) end return 0`;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// undefined = miss, null = cached "not a player", object = a real row. The sentinel is checked before the
// "has fields" test, because a hash holding only _missing would otherwise look like a hit.
async function readCache(redis, key) {
  const cached = await redis.hGetAll(key);
  if (Object.keys(cached).length === 0) return undefined;
  if (cached[MISSING_FIELD] === '1') return null;
  return cached;
}

async function loadAndStore(redis, db, key, playerId) {
  const { rows } = await db.query('SELECT * FROM player_stats($1)', [playerId]);
  const row = rows[0];
  if (!row) {
    await redis.multi().hSet(key, { [MISSING_FIELD]: '1' }).expire(key, MISSING_TTL_SECONDS).exec();
    return null;
  }
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
  if (hit !== undefined) return hit;

  const token = randomUUID();
  const won = await redis.set(lockKey, token, { condition: 'NX', expiration: { type: 'PX', value: LOCK_PX } });

  if (won === 'OK') {
    try {
      // Another winner may have filled the cache (or the sentinel) between our miss and our lock.
      const again = await readCache(redis, key);
      if (again !== undefined) return again;
      return await loadAndStore(redis, db, key, playerId);
    } finally {
      await redis.eval(RELEASE, { keys: [lockKey], arguments: [token] });
    }
  }

  // Not the winner: wait for the cache (or the sentinel) to appear, until the lock itself would have expired.
  const deadline = Date.now() + LOCK_PX;
  while (Date.now() < deadline) {
    await sleep(POLL_MS);
    // Lock first, cache second: if the lock is gone, the winner's write is already visible to the read.
    const stillLocked = await redis.exists(lockKey);
    const filled = await readCache(redis, key);
    if (filled !== undefined) return filled;
    if (!stillLocked) break;
  }
  return loadAndStore(redis, db, key, playerId);
}
