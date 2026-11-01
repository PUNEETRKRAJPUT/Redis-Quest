// Reference: Chapter 2's cache-aside, with every read through deps.redisCached (RESP 3 plus node-redis client-side caching) and every write
// through deps.redis. A read the client has already seen is answered from this process's memory and never reaches Redis; when anybody writes,
// expires or evicts the key, the server tells the client and the next read goes to Redis once. If the connection drops the client flushes it all.
// Postgres stays the source of truth: the hash is a copy allowed to be at most TTL_SECONDS stale.
const TTL_SECONDS = 30;

export default async function getPlayerStats({ redis, redisCached, db }, playerId) {
  const key = `cache:player:${playerId}`;

  // HGETALL on a missing key is an empty object, so "has fields" is the hit test.
  const cached = await redisCached.hGetAll(key);
  if (Object.keys(cached).length > 0) return cached;

  const { rows } = await db.query('SELECT * FROM player_stats($1)', [playerId]);
  const row = rows[0];
  if (!row) return null; // not a player: nothing worth caching

  // A hash holds strings only, so a null column is stored as an empty string.
  const fields = Object.fromEntries(
    Object.entries(row).map(([name, value]) => [name, value === null ? '' : String(value)]),
  );
  // Writes stay on the ordinary client. This write is also what invalidates the copy this very client holds for the key.
  await redis.multi().hSet(key, fields).expire(key, TTL_SECONDS).exec();
  return row;
}
