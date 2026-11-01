// Reference bundle: the two functions of the memory repair. Default export = recordView (the first slot).
// recordView: every view now carries a one-day life, written in the same SET (EX 86400), so no key exists without it.
// addTtls: repairs the keys already there. SCAN walks the keyspace (never KEYS), EXPIRE ... NX gives a deadline only to
// keys that have none (NX = only when the key has no expiry), and the page's EXPIREs go out as one pipeline.
// It returns how many keys gained a TTL.
export async function recordView({ redis }, userId, matchId) {
  await redis.set(`view:${userId}:${matchId}`, new Date().toISOString(), { EX: 86400 });
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
