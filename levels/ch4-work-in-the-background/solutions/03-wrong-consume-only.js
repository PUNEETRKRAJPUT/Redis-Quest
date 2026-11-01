// Wrong: consume is fine, but sweep recovers nothing. The balls w2 took and never finished stay pending for ever, and
// their points are never added.
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

export async function sweep() {
  return { reclaimed: [], deadLettered: [] };
}

export default consume;
