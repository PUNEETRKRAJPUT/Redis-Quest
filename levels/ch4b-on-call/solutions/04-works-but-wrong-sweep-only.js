// Works, but wrong: the sweep is right, so the thousand old keys get their deadline and the check that counts keys without a
// TTL passes. recordView is still the planted fault: the next view of the next fan is written with no expiry, so the leak
// is only paused until tomorrow's traffic.
export async function recordView({ redis }, userId, matchId) {
  await redis.set(`view:${userId}:${matchId}`, new Date().toISOString());
  return { ok: true };
}

export async function addTtls({ redis }, pattern, seconds) {
  let cursor = '0';
  let given = 0;
  do {
    const page = await redis.scan(cursor, { MATCH: pattern, COUNT: 1000 });
    cursor = String(page.cursor);
    if (page.keys.length > 0) {
      const pipeline = redis.multi();
      for (const key of page.keys) pipeline.expire(key, seconds, 'NX');
      const replies = await pipeline.execAsPipeline();
      given += replies.filter((reply) => Number(reply) === 1).length;
    }
  } while (cursor !== '0');
  return given;
}

export default recordView;
