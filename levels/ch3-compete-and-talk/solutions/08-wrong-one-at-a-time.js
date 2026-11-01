// Wrong: one ZADD per row, each awaited before the next is sent. The sorted sets end up correct, so a three-row
// check passes. With forty thousand rows that is forty thousand round trips back to back: the call takes seconds
// instead of a tenth of a second, and the recompute requests pile up behind it.
export default async function recompute({ redis }, rows) {
  let sent = 0;
  for (const r of rows) {
    await redis.zAdd(`lb:contest:${r.contestId}`, { score: r.points, value: r.teamId });
    sent += 1;
  }
  return { loaded: sent };
}
