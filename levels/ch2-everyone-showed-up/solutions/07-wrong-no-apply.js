// Wrong: bulkLoad and getFixtures are right, but applyChange does nothing. The cache is perfect at startup and then
// frozen: a venue change in the legacy database never reaches it, and the page shows the old ground until the
// safety-net TTL (an hour) finally drops the key. Same three-in-one layout as the reference:
//   bulkLoad     -> ch2/prefetch-bulk.js    (deps, rows)
//   applyChange  -> ch2/prefetch-apply.js   (deps, event)
//   getFixtures  -> ch2/prefetch.js         (deps)
// The default export below is getFixtures, so this file also works as ch2/prefetch.js on its own.

// The TTL is a safety net, not a freshness mechanism: freshness comes from the change events. It is refreshed
// on every upsert, so a match that keeps changing never expires, and a match whose events stopped does.
const TTL_SECONDS = 3600;

const keyOf = (id) => `cache:match:${id}`;

// A hash holds strings only, so numbers become strings and a null column becomes an empty string.
const asFields = (row) =>
  Object.fromEntries(Object.entries(row).map(([name, value]) => [name, value === null || value === undefined ? '' : String(value)]));

// Startup load: one pipelined round trip, DEL + HSET + EXPIRE per match. Not atomic, and it does not need to be:
// nothing reads the cache while it is being filled.
export async function bulkLoad({ redis }, rows) {
  if (rows.length === 0) return;
  const pipeline = redis.multi();
  for (const row of rows) {
    const key = keyOf(row.id);
    pipeline.del(key).hSet(key, asFields(row)).expire(key, TTL_SECONDS);
  }
  await pipeline.execAsPipeline();
}

// Wrong: the change feed is ignored.
export async function applyChange() {}

async function scanKeys(redis, pattern) {
  const keys = [];
  let cursor = '0';
  do {
    const reply = await redis.scan(cursor, { MATCH: pattern, COUNT: 500 });
    cursor = String(reply.cursor);
    keys.push(...reply.keys);
  } while (cursor !== '0');
  return keys;
}

// Reads Redis only. An empty cache is not "no fixtures", it is a broken sync pipeline, so it answers null
// (the app turns that into a loud error) instead of quietly asking Postgres and hiding the incident.
export async function getFixtures({ redis }) {
  const keys = await scanKeys(redis, 'cache:match:*');
  if (keys.length === 0) return null;

  const rows = await Promise.all(keys.map((key) => redis.hGetAll(key)));
  return rows
    .filter((row) => row.status === 'scheduled' || row.status === 'live')
    .sort((a, b) => Date.parse(a.starts_at) - Date.parse(b.starts_at) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

export default getFixtures;
