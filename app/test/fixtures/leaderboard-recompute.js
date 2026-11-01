// Reference for slot leaderboard.recompute: rebuild every contest's sorted set from the rows, pipelined in
// batches of 5000 commands (not atomic, and does not need to be: nothing reads the boards while they load).
export default async function recompute({ redis }, rows) {
  const BATCH = 5000;
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
