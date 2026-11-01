// Works, but wrong: single-flight whose lock has no PX and is released only after a successful load.
// A miss on an id that is not a player returns before the DEL, so that lock is held forever.
import { randomUUID } from 'node:crypto';

const TTL_SECONDS = 30;
const WAIT_MS = 5000;
const POLL_MS = 50;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function readCache(redis, key) {
  const cached = await redis.hGetAll(key);
  return Object.keys(cached).length > 0 ? cached : null;
}

async function load(db, playerId) {
  const { rows } = await db.query('SELECT * FROM player_stats($1)', [playerId]);
  return rows[0] ?? null;
}

async function store(redis, key, row) {
  const fields = Object.fromEntries(
    Object.entries(row).map(([name, value]) => [name, value === null ? '' : String(value)]),
  );
  await redis.multi().hSet(key, fields).expire(key, TTL_SECONDS).exec();
}

export default async function getPlayerStats({ redis, db }, playerId) {
  const key = `cache:player:${playerId}`;
  const lockKey = `lock:${key}`;

  const hit = await readCache(redis, key);
  if (hit) return hit;

  const won = await redis.set(lockKey, randomUUID(), { condition: 'NX' }); // no PX
  if (won === 'OK') {
    const row = await load(db, playerId);
    if (!row) return null; // lock never released on this path
    await store(redis, key, row);
    await redis.del(lockKey); // only on success, and with no token check
    return row;
  }

  const deadline = Date.now() + WAIT_MS;
  while (Date.now() < deadline) {
    await sleep(POLL_MS);
    const filled = await readCache(redis, key);
    if (filled) return filled;
  }
  const row = await load(db, playerId);
  if (!row) return null;
  await store(redis, key, row);
  return row;
}
