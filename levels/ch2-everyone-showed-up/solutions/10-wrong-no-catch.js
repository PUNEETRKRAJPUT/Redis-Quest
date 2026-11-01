// Wrong: level 2's cache-aside, untouched. It is correct while Redis answers, but any Redis error ("The client is
// offline", a command timeout, a WRONGTYPE reply) is thrown straight out of getPlayerStats, so the page turns
// into a 500 for as long as the cache is unhealthy.
// Reference: cache-aside with a bounded TTL, one hash per player (redis.io use case "cache-aside").
// Postgres stays the source of truth; Redis is a copy allowed to be at most TTL_SECONDS stale.
const TTL_SECONDS = 30;

export default async function getPlayerStats({ redis, db }, playerId) {
  const key = `cache:player:${playerId}`;

  // HGETALL on a missing key is an empty object, so "has fields" is the hit test.
  const cached = await redis.hGetAll(key);
  if (Object.keys(cached).length > 0) return cached;

  const { rows } = await db.query('SELECT * FROM player_stats($1)', [playerId]);
  const row = rows[0];
  if (!row) return null; // not a player: nothing worth caching

  // A hash holds strings only, so a null column is stored as an empty string.
  const fields = Object.fromEntries(
    Object.entries(row).map(([name, value]) => [name, value === null ? '' : String(value)]),
  );
  // One MULTI: the hash never exists without its expiry.
  await redis.multi().hSet(key, fields).expire(key, TTL_SECONDS).exec();
  return row;
}
