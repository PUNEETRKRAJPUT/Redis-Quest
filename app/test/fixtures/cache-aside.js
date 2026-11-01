// Reference cache-aside for slot cache.getPlayerStats (used by app tests and scripts/check/P0-07.sh).
export default async function getPlayerStats({ redis, db }, playerId) {
  const key = `cache:player-stats:${playerId}`;
  const cached = await redis.hGetAll(key);
  if (Object.keys(cached).length > 0) return cached;
  const { rows } = await db.query('SELECT * FROM player_stats($1)', [playerId]);
  if (!rows[0]) return null;
  await redis.hSet(key, Object.fromEntries(Object.entries(rows[0]).map(([k, v]) => [k, v ?? ''])));
  await redis.expire(key, 300);
  return rows[0];
}
