// Wrong: re-reads Postgres and rewrites the cache. Fine for one writer; two writers can race and
// leave an older value in the cache. The docs' rule is to delete and let the next read refill it.
export default async function invalidatePlayerStats({ redis, db }, playerId) {
  const key = `cache:player:${playerId}`;
  const { rows } = await db.query('SELECT * FROM player_stats($1)', [playerId]);
  const row = rows[0];
  if (!row) return null;
  const fields = Object.fromEntries(
    Object.entries(row).map(([name, value]) => [name, value === null ? '' : String(value)]),
  );
  await redis.multi().hSet(key, fields).expire(key, 30).exec();
  return null;
}
