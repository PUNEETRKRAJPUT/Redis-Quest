// Reference: rebuild every contest's sorted set from the rows, pipelined in batches of 5000 commands.
// A pipeline sends many commands without waiting for each reply, so forty thousand ZADDs cost a handful of round
// trips instead of forty thousand. It is not atomic, and it does not have to be here: nothing reads these boards
// while they load. Batches keep the server from holding every reply in memory at once.
const BATCH = 5000;

export default async function recompute({ redis }, rows) {
  let sent = 0;
  for (let i = 0; i < rows.length; i += BATCH) {
    const pipeline = redis.multi();
    for (const r of rows.slice(i, i + BATCH)) {
      pipeline.zAdd(`lb:contest:${r.contestId}`, { score: r.points, value: r.teamId });
    }
    await pipeline.execAsPipeline();
    sent += Math.min(BATCH, rows.length - i);
  }
  return { loaded: sent };
}
