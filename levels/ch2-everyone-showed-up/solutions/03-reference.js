// Reference: delete on write. The next getPlayerStats misses and refills from Postgres, through the
// one code path that knows how a cache entry is built. DEL on a key that is not there just removes nothing.
export default async function invalidatePlayerStats({ redis }, playerId) {
  await redis.del(`cache:player:${playerId}`);
}
