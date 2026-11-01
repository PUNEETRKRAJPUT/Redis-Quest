// Wrong: read the balance, decide in JavaScript, then DECRBY. One request at a time it is exact. Fifty at once all
// read 100, all decide there is enough, and all fifty fees are taken: the wallet goes below zero and fifty
// people are in a contest that ten could afford.
export default async function join({ redis }, userId, contestId, fee) {
  const wallet = `wallet:${userId}`;
  const balance = Number(await redis.get(wallet));
  if (!(balance >= fee)) return false;
  await redis.decrBy(wallet, fee);
  await redis.incr(`contest:${contestId}:entries`);
  return true;
}
