// Works, but wrong: the group splits the balls and the points are right, but nothing is ever acknowledged. Every delivered
// ball stays in the pending list, so after the next restart each of them is handed out again and the points are added twice.
const GROUP = 'points';

export default async function consume({ redis }, matchId, consumer, count) {
  const key = `match:${matchId}:balls`;
  try {
    await redis.xGroupCreate(key, GROUP, '0-0', { MKSTREAM: true });
  } catch (err) {
    if (!String(err && err.message).includes('BUSYGROUP')) throw err;
  }

  const streams = await redis.xReadGroup(GROUP, consumer, { key, id: '>' }, { COUNT: count });
  const processed = [];
  for (const { messages } of streams ?? []) {
    for (const { id, message } of messages) {
      await redis.zIncrBy(`lb:match:${matchId}`, Number(message.runs), message.batter);
      processed.push(id);
    }
  }
  return { processed };
}
