// Wrong: Chapter 2's cache-aside with every read through the ordinary client. Correct, and one HGETALL per request on the same key,
// so the celebrity traffic costs about one Redis command per request. The traffic check allows 0.05.
const TTL_SECONDS = 30;

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
  await redis.multi().hSet(key, fields).expire(key, TTL_SECONDS).exec();
  return row;
}
