// Makes concurrency observable: every call does INCR on one key, so after N calls the counter is
// exactly N no matter how many calls ran at the same time (INCR is atomic on the server).
// Run it with { calls: 50 x {}, concurrency: 50 } and read the key afterwards.
export default async function (deps) {
  const { redis } = deps;
  return await redis.incr('runner:example:counter');
}
