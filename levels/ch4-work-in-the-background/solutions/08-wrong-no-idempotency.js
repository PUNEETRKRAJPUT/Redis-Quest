// Wrong: every call credits. The same job delivered twice pays twice: 100 + 50 + 50.
export default async function credit({ redis }, userId, amount) {
  const balance = await redis.incrBy(`wallet:${userId}`, amount);
  return { credited: true, balance };
}
