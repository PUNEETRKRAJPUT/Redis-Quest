// Wrong: sweep claims the dead worker's balls and adds their points, but never acknowledges them. They are now pending
// under w1 instead of w2, and the next sweep claims them again and adds the points a second time.
const GROUP = 'points';

export async function consume({ redis }, matchId, consumer, count) {
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
      await redis.xAck(key, GROUP, id);
      processed.push(id);
    }
  }
  return { processed };
}

export async function sweep({ redis }, matchId, consumer, minIdleMs) {
  const key = `match:${matchId}:balls`;
  const claimed = await redis.xAutoClaim(key, GROUP, consumer, minIdleMs, '0-0', { COUNT: 100 });
  const reclaimed = [];
  for (const entry of claimed.messages) {
    if (!entry) continue;
    await redis.zIncrBy(`lb:match:${matchId}`, Number(entry.message.runs), entry.message.batter);
    reclaimed.push(entry.id);
  }
  return { reclaimed, deadLettered: [] };
}

export default consume;
