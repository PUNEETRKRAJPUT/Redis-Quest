// Reference: cache-aside with a bounded TTL (redis.io use case "cache-aside").
const TTL_SECONDS = 30;

export default async function getPlayerStats({ redis, db }, playerId) {
  const key = `cache:player:${playerId}`;

  const cached = await redis.hGetAll(key);
  if (Object.keys(cached).length > 0) return cached;

  const { rows } = await db.query('SELECT * FROM player_stats($1)', [playerId]);
  const row = rows[0];
  if (!row) return null;

  // Hash values are strings in Redis; convert once so a hit and a miss return the same shape.
  const fields = Object.fromEntries(Object.entries(row).map(([k, v]) => [k, String(v)]));
  // One MULTI: the key never exists without its expiry.
  await redis.multi().hSet(key, fields).expire(key, TTL_SECONDS).exec();
  return fields;
}
