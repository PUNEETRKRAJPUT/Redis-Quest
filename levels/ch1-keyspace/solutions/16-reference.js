// Reference: the three writes of a registration, queued in one transaction and sent once.
// MULTI/EXEC runs them back to back with no other client's command in the middle, and if the
// connection drops before EXEC, none of them run. node-redis names are camelCase: hSet, sAdd, zAdd.
export default async function registerUser({ redis }, user) {
  const { id, name, college, hostel } = user;
  await redis
    .multi()
    .hSet(`user:${id}`, { name, college, hostel })
    .sAdd('users:registered', id)
    .zAdd(`lb:hostel:${hostel}`, { score: 0, value: `user:${id}` })
    .exec();
}
