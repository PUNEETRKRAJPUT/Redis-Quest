// Wrong: a client per call, and it also reads only the name, so the answer has no id. The behavior check fails on the missing
// id. The real sin is the first line: a new connection for every lookup. Here it is closed after the request, which is why the
// game's own sandbox cannot show the leak from this file; the planted baseline never closes its client, and that is what
// climbed connected_clients on the app side.
export default async function lookupTeam({ redis }, teamId) {
  const own = redis.duplicate();
  await own.connect();
  try {
    const name = await own.hGet(`team:${teamId}`, 'name');
    if (name === undefined || name === null) return null;
    return { name };
  } finally {
    own.destroy();
  }
}
