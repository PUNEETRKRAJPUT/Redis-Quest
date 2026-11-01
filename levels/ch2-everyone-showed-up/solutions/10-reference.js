// Reference: the cache is an optimisation, so Redis being unhealthy must never take the page down. Every Redis
// failure (the client is offline, a command timed out, an error reply) ends in the same place: ask Postgres.
// Postgres errors are different: that is a real outage, and they are not swallowed.
import { randomUUID } from 'node:crypto';

const TTL_SECONDS = 30;
const MISSING_TTL_SECONDS = 5;
const MISSING_FIELD = '_missing';
const LOCK_PX = 5000;
const POLL_MS = 50;

const RELEASE = `if redis.call('GET', KEYS[1]) == ARGV[1] then return redis.call('DEL', KEYS[1]) end return 0`;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function readCache(redis, key) {
  const cached = await redis.hGetAll(key);
  if (Object.keys(cached).length === 0) return undefined;
  if (cached[MISSING_FIELD] === '1') return null;
  return cached;
}

export default async function getPlayerStats({ redis, db, log }, playerId) {
  const key = `cache:player:${playerId}`;
  const lockKey = `lock:${key}`;

  // Postgres is read at most once per call, and a Postgres error is never mistaken for a Redis one.
  let loaded = false;
  let loadedRow = null;
  let postgresError = null;
  const loadFromPostgres = async () => {
    try {
      const { rows } = await db.query('SELECT * FROM player_stats($1)', [playerId]);
      loadedRow = rows[0] ?? null;
      loaded = true;
      return loadedRow;
    } catch (err) {
      postgresError = err;
      throw err;
    }
  };

  const loadAndStore = async () => {
    const row = await loadFromPostgres();
    if (!row) {
      await redis.multi().hSet(key, { [MISSING_FIELD]: '1' }).expire(key, MISSING_TTL_SECONDS).exec();
      return null;
    }
    const fields = Object.fromEntries(
      Object.entries(row).map(([name, value]) => [name, value === null ? '' : String(value)]),
    );
    await redis.multi().hSet(key, fields).expire(key, TTL_SECONDS).exec();
    return row;
  };

  try {
    const hit = await readCache(redis, key);
    if (hit !== undefined) return hit;

    const token = randomUUID();
    const won = await redis.set(lockKey, token, { condition: 'NX', expiration: { type: 'PX', value: LOCK_PX } });

    if (won === 'OK') {
      try {
        const again = await readCache(redis, key);
        if (again !== undefined) return again;
        return await loadAndStore();
      } finally {
        // Releasing is best effort: if Redis is gone the lock expires by itself (PX).
        await redis.eval(RELEASE, { keys: [lockKey], arguments: [token] }).catch(() => {});
      }
    }

    const deadline = Date.now() + LOCK_PX;
    while (Date.now() < deadline) {
      await sleep(POLL_MS);
      const stillLocked = await redis.exists(lockKey);
      const filled = await readCache(redis, key);
      if (filled !== undefined) return filled;
      if (!stillLocked) break;
    }
    return await loadAndStore();
  } catch (err) {
    if (postgresError) throw postgresError; // not a cache problem
    if (typeof log === 'function') log(`cache unavailable, serving player ${playerId} from Postgres: ${err.message}`);
    // Redis failed after Postgres had already answered: use that answer, do not ask twice.
    return loaded ? loadedRow : loadFromPostgres();
  }
}
