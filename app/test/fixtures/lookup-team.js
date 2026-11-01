// Reference repair: use the app's shared client from deps. No client is created, so no connection is leaked.
export default async function lookupTeam({ redis }, teamId) {
  const team = await redis.hGetAll(`team:${teamId}`);
  if (!team || team.id === undefined) return null;
  return { id: team.id, name: team.name };
}
