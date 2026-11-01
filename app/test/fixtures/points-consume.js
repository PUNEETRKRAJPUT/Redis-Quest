// Reference for slot points.consume: a consumer group worker. The stream is match:<matchId>:balls, the group is
// `points`, and the leaderboard is the sorted set lb:match:<matchId> (score = runs per batter).
//   XGROUP CREATE ... MKSTREAM   once, BUSYGROUP means someone else already did
//   XREADGROUP ... >             only entries no consumer of the group has been given yet
//   ZINCRBY, then XACK           ack only after the points are in, so a crash replays the ball (at-least-once)
export default async function consume({ redis }, matchId, consumer, count) {
  const stream = `match:${matchId}:balls`;
  try {
    await redis.xGroupCreate(stream, 'points', '0-0', { MKSTREAM: true });
  } catch (err) {
    if (!String(err && err.message).includes('BUSYGROUP')) throw err;
  }
  const reply = await redis.xReadGroup(
    'points',
    consumer,
    { key: stream, id: '>' },
    { COUNT: count },
  );
  const processed = [];
  for (const { id, message } of reply?.[0]?.messages ?? []) {
    await redis.zIncrBy(`lb:match:${matchId}`, Number(message.runs), message.batter);
    await redis.xAck(stream, 'points', id);
    processed.push(id);
  }
  return { processed };
}
