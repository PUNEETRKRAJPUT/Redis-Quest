// Three commands in one MULTI/EXEC transaction. The runner counts a multi() as ONE command when it
// is executed, so redisCommands is 1 for this module.
export default async function (deps) {
  const { redis } = deps;
  const replies = await redis
    .multi()
    .set('runner:example:multi', '1')
    .incr('runner:example:multi')
    .get('runner:example:multi')
    .exec();
  return replies;
}
