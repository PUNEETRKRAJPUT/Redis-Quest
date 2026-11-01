// Wrong: the hash and the set entry, but the leaderboard step is missing.
export default async function registerUser({ redis }, user) {
  const { id, name, college, hostel } = user;
  await redis
    .multi()
    .hSet(`user:${id}`, { name, college, hostel })
    .sAdd('users:registered', id)
    .exec();
}
