// Reference: a consumer group named "points" shares the balls between workers.
//   match:<id>:balls   the stream of balls (fields over, ball, batter, runs)
//   lb:match:<id>      points per batter, a sorted set
// XGROUP CREATE ... 0-0 MKSTREAM makes the group once (a second attempt answers BUSYGROUP, which is fine). XREADGROUP with
// the id ">" asks for entries this group has never delivered to anyone, so two workers split the stream between them.
// A delivered entry sits in the group's pending list until XACK, so we acknowledge only after the points are added.
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
      await redis.xAck(key, GROUP, id);
      processed.push(id);
    }
  }
  return { processed };
}
