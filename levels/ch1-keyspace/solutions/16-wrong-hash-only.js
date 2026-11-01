// Wrong: only the profile hash. No registered-set entry and no place on the hostel's board.
export default async function registerUser({ redis }, user) {
  const { id, name, college, hostel } = user;
  await redis.hSet(`user:${id}`, { name, college, hostel });
}
