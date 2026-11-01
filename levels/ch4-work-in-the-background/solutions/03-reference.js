// Reference bundle for levels 2 and 3: consume (level 2) and sweep (this level), one file, the same group.
// Default export = consume, named exports = the slot names after the dot.
//
// sweep recovers entries a dead worker left in the group's pending list. XAUTOCLAIM hands us every pending entry that has been
// idle for at least minIdleMs (in production something like 60000, so we never rob a worker that is merely busy; here 0 so
// the check does not have to wait). Claiming bumps the delivery counter, so the counter we read afterwards already counts this
// claim. An entry at or over maxDeliveries is a poison ball: it goes to the dead-letter stream, and is acknowledged on the
// original so it stops coming back. The rest are processed and acknowledged.
const GROUP = 'points';

async function addPoints(redis, matchId, message) {
  await redis.zIncrBy(`lb:match:${matchId}`, Number(message.runs), message.batter);
}

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
      await addPoints(redis, matchId, message);
      await redis.xAck(key, GROUP, id);
      processed.push(id);
    }
  }
  return { processed };
}

export async function sweep({ redis }, matchId, consumer, minIdleMs, maxDeliveries) {
  const key = `match:${matchId}:balls`;
  const claimed = await redis.xAutoClaim(key, GROUP, consumer, minIdleMs, '0-0', { COUNT: 100 });
  const reclaimed = [];
  const deadLettered = [];
  for (const entry of claimed.messages) {
    if (!entry) continue;
    const { id, message } = entry;
    const [pending] = await redis.xPendingRange(key, GROUP, id, id, 1);
    const deliveries = pending ? pending.deliveriesCounter : 0;
    if (deliveries >= maxDeliveries) {
      await redis.xAdd(`match:${matchId}:balls:dead`, '*', {
        ...message,
        original_id: id,
        reason: `delivered ${deliveries} times`,
      });
      await redis.xAck(key, GROUP, id);
      deadLettered.push(id);
    } else {
      await addPoints(redis, matchId, message);
      await redis.xAck(key, GROUP, id);
      reclaimed.push(id);
    }
  }
  return { reclaimed, deadLettered };
}

export default consume;
