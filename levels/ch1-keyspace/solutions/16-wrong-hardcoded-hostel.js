// Wrong: the leaderboard key ignores the user's hostel.
export default async function registerUser({ redis }, user) {
  const { id, name, college, hostel } = user;
  await redis
    .multi()
    .hSet(`user:${id}`, { name, college, hostel })
    .sAdd('users:registered', id)
    .zAdd('lb:hostel:h-c-02-1', { score: 0, value: `user:${id}` })
    .exec();
}
