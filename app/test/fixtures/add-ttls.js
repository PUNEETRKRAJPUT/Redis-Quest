// Reference repair: SCAN the keyspace, EXPIRE what matches, pipelined one page at a time. Keys that already have a
// TTL are left alone (EXPIRE ... NX), so the count is the number of keys that gained one.
export default async function addTtls({ redis }, pattern, seconds) {
  let cursor = '0';
  let given = 0;
  do {
    const page = await redis.scan(cursor, { MATCH: pattern, COUNT: 1000 });
    cursor = String(page.cursor);
    if (page.keys.length > 0) {
      const results = await Promise.all(page.keys.map((key) => redis.expire(key, seconds, 'NX')));
      given += results.filter(Boolean).length;
    }
  } while (cursor !== '0');
  return given;
}
