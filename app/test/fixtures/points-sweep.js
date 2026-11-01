// Reference for slot points.sweep: take over what a dead consumer left in the pending list.
//   XAUTOCLAIM ... minIdleMs     hands every entry idle for at least that long to `consumer`; node-redis returns
//                                { nextId, messages, deletedMessages } (deletedMessages: ids still pending whose
//                                entry was trimmed or deleted; Redis drops them from the PEL for you)
//   XPENDING key group id id 1   the delivery counter of one entry; XAUTOCLAIM and XCLAIM each add one
// An entry at or over maxDeliveries is a poison ball: copy it to match:<matchId>:balls:dead and ack the original.
export default async function sweep({ redis }, matchId, consumer, minIdleMs, maxDeliveries) {
  const stream = `match:${matchId}:balls`;
  const reclaimed = [];
  const deadLettered = [];
  let cursor = '0-0';
  do {
    const r = await redis.xAutoClaim(stream, 'points', consumer, minIdleMs, cursor, { COUNT: 100 });
    cursor = r.nextId;
    for (const { id, message } of r.messages) {
      const [p] = await redis.xPendingRange(stream, 'points', id, id, 1);
      if (p && p.deliveriesCounter >= maxDeliveries) {
        await redis.xAdd(`${stream}:dead`, '*', {
          ...message,
          reason: 'max-deliveries',
          original_id: id,
          deliveries: String(p.deliveriesCounter),
        });
        await redis.xAck(stream, 'points', id);
        deadLettered.push(id);
      } else {
        await redis.zIncrBy(`lb:match:${matchId}`, Number(message.runs), message.batter);
        await redis.xAck(stream, 'points', id);
        reclaimed.push(id);
      }
    }
  } while (cursor !== '0-0');
  return { reclaimed, deadLettered };
}
