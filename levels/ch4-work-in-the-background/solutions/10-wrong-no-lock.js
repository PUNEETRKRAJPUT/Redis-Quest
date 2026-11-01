// Wrong: look, then take. Two hundred callers all read 1 before any of them decrements, so all of them take "the last slot".
export default async function claimLastSlot({ redis }, contestId, userId) {
  const slots = `contest:${contestId}:slots`;
  const left = Number(await redis.get(slots));
  if (left > 0) {
    await redis.decr(slots);
    await redis.sAdd(`contest:${contestId}:members`, userId);
    return true;
  }
  return false;
}
