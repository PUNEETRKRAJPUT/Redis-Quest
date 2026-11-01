// Wrong: sweep processes every claimed ball and, when one throws, swallows the error and leaves the ball pending to be tried
// again at the next sweep. The poison ball (runs "x") fails every time, is never dead-lettered, never acknowledged, and is
// retried for ever. The dead-letter stream stays empty.
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
    try {
      await redis.zIncrBy(`lb:match:${matchId}`, Number(entry.message.runs), entry.message.batter);
      await redis.xAck(key, GROUP, entry.id);
      reclaimed.push(entry.id);
    } catch {
      // try again next time
    }
  }
  return { reclaimed, deadLettered: [] };
}

export default sweep;
