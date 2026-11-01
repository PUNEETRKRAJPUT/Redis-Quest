// Reference for slot contest.join: optimistic locking with WATCH. WATCH is per connection, so it needs its own
// connection (the shared one serves every request at once): duplicate() gives an unconnected clone that the
// learner must connect() itself, and the app closes it after the request.
//   wallet:<userId>       the balance, a plain string
//   contest:<id>:entries  how many fees were taken for the contest
export default async function join({ redis }, userId, contestId, fee) {
  const conn = redis.duplicate();
  await conn.connect();
  const wallet = `wallet:${userId}`;
  for (let attempt = 0; attempt < 200; attempt++) {
    await conn.watch(wallet);
    const balance = Number(await conn.get(wallet));
    if (!(balance >= fee)) {
      await conn.unwatch();
      return false;
    }
    try {
      await conn.multi().decrBy(wallet, fee).incr(`contest:${contestId}:entries`).exec();
      return true;
    } catch (err) {
      // Someone changed the wallet between WATCH and EXEC: exec() throws a WatchError and nothing ran. Its
      // `name` is just "Error", so recognise it by its class name (a workspace file cannot import it).
      if (err && err.constructor && err.constructor.name === 'WatchError') continue;
      throw err;
    }
  }
  throw new Error('wallet is too contended: gave up after 200 attempts');
}
