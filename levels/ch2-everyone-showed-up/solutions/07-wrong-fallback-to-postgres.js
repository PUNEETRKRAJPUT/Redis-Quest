// Works, but wrong: a perfectly good prefetch cache whose getFixtures quietly asks Postgres when Redis has nothing.
// The page never breaks, so nobody notices the sync pipeline died, and the first match-day crowd lands on Postgres.
// Same three-in-one layout as the reference:
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

// One change event from the legacy database. The slot is called for every table, so filter first.
export async function applyChange({ redis }, event) {
  if (event.aggregate !== 'matches') return;
  const key = keyOf(event.aggregateId);

  if (event.op === 'delete') {
    await redis.del(key);
    return;
  }

  const fields = asFields(event.payload);
  // The event is a row of `matches`: team ids, no team names. bulkLoad joined the names in, so keep them.
  const [home, away] = await redis.hmGet(key, ['home_team_name', 'away_team_name']);
  if (home) fields.home_team_name = home;
  if (away) fields.away_team_name = away;

  // DEL first, in the same MULTI, so a field the new row no longer has cannot linger from the old one.
  await redis.multi().del(key).hSet(key, fields).expire(key, TTL_SECONDS).exec();
}

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

export async function getFixtures({ redis, db }) {
  const keys = await scanKeys(redis, 'cache:match:*');
  if (keys.length === 0) {
    // The silent fallback: looks like resilience, is a hidden incident.
    const { rows } = await db.query(
      `SELECT id, season, home_team_id, away_team_id, venue, starts_at, status
         FROM matches WHERE status IN ('scheduled', 'live') ORDER BY starts_at, id`,
    );
    return rows;
  }

  const rows = await Promise.all(keys.map((key) => redis.hGetAll(key)));
  return rows
    .filter((row) => row.status === 'scheduled' || row.status === 'live')
    .sort((a, b) => Date.parse(a.starts_at) - Date.parse(b.starts_at) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

export default getFixtures;
