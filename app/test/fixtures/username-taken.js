// Reference for slot users.usernameTaken: a Bloom filter in front of Postgres. BF.EXISTS says "definitely not
// there" (no false negatives) or "probably there" (rare false positives), so only a "probably" costs a query.
// The filter is bf:usernames; node-redis has typed methods for the module commands (redis.bf.exists).
export default async function usernameTaken({ redis, db }, name) {
  if (!(await redis.bf.exists('bf:usernames', name))) return { taken: false, checkedDb: false };
  const { rows } = await db.query('SELECT 1 FROM users WHERE handle = $1', [name]);
  return { taken: rows.length > 0, checkedDb: true };
}
