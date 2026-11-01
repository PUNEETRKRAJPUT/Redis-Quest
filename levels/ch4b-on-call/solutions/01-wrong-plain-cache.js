// Wrong: Chapter 2's cache-aside, unchanged. It is correct, and it is the fault of this level: every request, for the
// same player, still costs one HGETALL. At a hundred connections that is thousands of Redis commands a second for
// one key, so the traffic check (Redis commands per request, at most 0.2) fails.
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
