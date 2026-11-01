// Works, but wrong: a correct cache-aside whose hash never expires, so stats go stale forever.
export default async function getPlayerStats({ redis, db }, playerId) {
  const key = `cache:player:${playerId}`;
  const cached = await redis.hGetAll(key);
  if (Object.keys(cached).length > 0) return cached;

  const { rows } = await db.query('SELECT * FROM player_stats($1)', [playerId]);
  const row = rows[0];
  if (!row) return null;
  const fields = Object.fromEntries(
    Object.entries(row).map(([name, value]) => [name, value === null ? '' : String(value)]),
  );
  await redis.hSet(key, fields); // no EXPIRE
  return row;
}
