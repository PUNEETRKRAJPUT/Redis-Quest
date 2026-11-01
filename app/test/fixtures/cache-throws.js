// A broken cache slot: throws on every call.
export default async function getPlayerStats({ redis }, playerId) {
  await redis.exists(`cache:player-stats:${playerId}`);
  throw new Error(`cache exploded for ${playerId}`);
}
