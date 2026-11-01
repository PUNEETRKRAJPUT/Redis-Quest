// Wrong on a cluster: Chapter 3's join, unchanged. WATCH needs one connection to one node, so on a cluster it dies with
// 'conn.watch is not a function' before anything else; and its MULTI over wallet:<u> and contest:<id>:entries would be refused anyway
// (CROSSSLOT, or MOVED), because the two keys hash to different slots.
// Reference: optimistic locking with WATCH.
//   wallet:<userId>       the points balance, a plain string
//   contest:<id>:entries  how many entry fees were taken for the contest
// WATCH belongs to one connection, and the shared client serves every request at once, so the call takes its own
// connection with duplicate(). A duplicate starts closed: connect() it. The game closes it when the call ends.
// Flow: WATCH the wallet, read it, decide, then MULTI ... EXEC. If anyone changed the wallet between WATCH and
// EXEC, the transaction is aborted and nothing in it ran, so read again and retry.
const MAX_ATTEMPTS = 200;

export default async function join({ redis }, userId, contestId, fee) {
  const conn = redis.duplicate();
  await conn.connect();
  const wallet = `wallet:${userId}`;
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
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
      // In this node-redis an aborted EXEC throws a WatchError (its name is plain "Error", so test the class name;
      // a workspace file cannot import it). Anything else is a real failure.
      if (err && err.constructor && err.constructor.name === 'WatchError') continue;
      throw err;
    }
  }
  throw new Error('wallet is too contended: gave up after 200 attempts');
}
