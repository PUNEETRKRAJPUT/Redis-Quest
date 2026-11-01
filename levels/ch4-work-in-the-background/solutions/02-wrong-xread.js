// Wrong: plain XREAD has no group, so no worker remembers anything. Every call starts from the first ball again: w2 is
// handed the same three balls as w1 and the other three are never touched.
export default async function consume({ redis }, matchId, consumer, count) {
  const key = `match:${matchId}:balls`;
  const streams = await redis.xRead({ key, id: '0' }, { COUNT: count });
  const processed = [];
  for (const { messages } of streams ?? []) {
    for (const { id, message } of messages) {
      await redis.zIncrBy(`lb:match:${matchId}`, Number(message.runs), message.batter);
      processed.push(id);
    }
  }
  return { processed };
}
