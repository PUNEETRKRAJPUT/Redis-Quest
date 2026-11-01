// Reference: no EVAL. The work is done from JavaScript in small steps, so Redis serves everyone else between them.
// SCAN walks the sorted sets lb:match:* a hundred keys at a time (TYPE zset skips anything else under the prefix),
// ZCOUNT counts the members with a score of 50 or more inside Redis, and HSET writes the answer for that match.
// Each step costs microseconds. Nothing here can hold the server, so there is nothing to kill at 2 am.
export default async function recomputeBadges({ redis }) {
  let cursor = '0';
  let matches = 0;
  do {
    const page = await redis.scan(cursor, { MATCH: 'lb:match:*', COUNT: 100, TYPE: 'zset' });
    cursor = String(page.cursor);
    for (const key of page.keys) {
      const matchId = key.slice('lb:match:'.length);
      const fifties = await redis.zCount(key, 50, '+inf');
      await redis.hSet('badges:fifties', matchId, String(fifties));
      matches += 1;
    }
  } while (cursor !== '0');
  return { matches };
}
