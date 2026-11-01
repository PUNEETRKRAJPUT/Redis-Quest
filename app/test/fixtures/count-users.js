// Reference repair: SCAN in pages instead of KEYS, so Redis is never blocked for one long command.
export default async function countUsers({ redis }, prefix) {
  let cursor = '0';
  let count = 0;
  do {
    const page = await redis.scan(cursor, { MATCH: `${prefix}*`, COUNT: 1000 });
    cursor = String(page.cursor);
    count += page.keys.length;
  } while (cursor !== '0');
  return count;
}
