// Reference: Chapter 2's cache-aside, with a one-second memo in this process in front of Redis.
// The memo answers the thousandth phone of the same second from memory: no Redis command at all. The price is
// that a page can be at most MEMO_MS older than Redis; here that is one second of a batter's runs.
// The memo keeps the promise of the read, not just the row: when a hundred requests arrive in the same instant after the
// memo has expired, they share one read instead of sending a hundred (the stampede of Chapter 2, in miniature).
// The Map is bounded (it is cleared when it grows past MAX_ENTRIES), because a local cache needs a memory limit too.
const TTL_SECONDS = 30; // how long Redis keeps the hash (Chapter 2)
const MEMO_MS = 1000; // how long this process trusts its own copy
const MAX_ENTRIES = 1000;
const memo = new Map(); // playerId -> { until, pending }

async function load({ redis, db }, playerId) {
  const key = `cache:player:${playerId}`;
  const cached = await redis.hGetAll(key);
  if (Object.keys(cached).length > 0) return cached;

  const { rows } = await db.query('SELECT * FROM player_stats($1)', [playerId]);
  const row = rows[0];
  if (!row) return null; // not a player: nothing worth caching, in Redis or in memory
  const fields = Object.fromEntries(
    Object.entries(row).map(([name, value]) => [name, value === null ? '' : String(value)]),
  );
  await redis.multi().hSet(key, fields).expire(key, TTL_SECONDS).exec();
  return row;
}

export default async function getPlayerStats(deps, playerId) {
  const now = Date.now();
  const hot = memo.get(playerId);
  if (hot && hot.until > now) return hot.pending;

  const pending = load(deps, playerId);
  if (memo.size >= MAX_ENTRIES) memo.clear();
  const entry = { until: now + MEMO_MS, pending };
  memo.set(playerId, entry);
  try {
    const row = await pending;
    if (row === null && memo.get(playerId) === entry) memo.delete(playerId); // never remember a missing player
    return row;
  } catch (err) {
    if (memo.get(playerId) === entry) memo.delete(playerId); // never remember a failure
    throw err;
  }
}
