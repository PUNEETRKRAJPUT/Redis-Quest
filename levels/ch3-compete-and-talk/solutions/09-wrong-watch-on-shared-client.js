// Wrong: WATCH on the shared client. A WATCH belongs to a connection, and every request in the process uses this
// one connection. Fifty calls all WATCH the same wallet on it, all read 100, and the first EXEC clears the watch for
// every call at once; the other forty-nine EXECs run with nothing watched and take their fee anyway.
export default async function join({ redis }, userId, contestId, fee) {
  const wallet = `wallet:${userId}`;
  for (let attempt = 0; attempt < 200; attempt++) {
    await redis.watch(wallet);
    const balance = Number(await redis.get(wallet));
    if (!(balance >= fee)) {
      await redis.unwatch();
      return false;
    }
    try {
      await redis.multi().decrBy(wallet, fee).incr(`contest:${contestId}:entries`).exec();
      return true;
    } catch (err) {
      if (err && err.constructor && err.constructor.name === 'WatchError') continue;
      throw err;
    }
  }
  throw new Error('gave up after 200 attempts');
}
