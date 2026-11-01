// A tiny override that never touches Postgres; the version string lets tests see hot reloads.
export default async function getPlayerStats({ redis, log }, playerId) {
  await redis.incr('test:p07:calls');
  log('fake cache called for', playerId);
  return { player_id: playerId, source: 'learner', version: 'v1' };
}
