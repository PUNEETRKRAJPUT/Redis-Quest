// Reference: use the app's one shared client, from deps. It already holds a connection and sends every command down it,
// so a hundred lookups at once are a hundred commands on one socket, not a hundred sockets. Nothing is created, so
// nothing can be left open. (A second connection is for blocking commands and subscriptions only: client.duplicate().)
export default async function lookupTeam({ redis }, teamId) {
  const team = await redis.hGetAll(`team:${teamId}`);
  if (!team || team.id === undefined) return null;
  return { id: team.id, name: team.name };
}
