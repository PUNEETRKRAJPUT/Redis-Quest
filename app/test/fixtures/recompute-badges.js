// Reference repair: no EVAL. The work is done from JavaScript in small steps, so Redis serves other clients between them.
// For every lb:match:<matchId> sorted set, count the members with score >= 50 into hash badges:fifties.
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
