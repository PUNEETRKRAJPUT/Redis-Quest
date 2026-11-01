// Reference: ask the Bloom filter first. A "no" from a Bloom filter is certain (no false negatives), so the name is free and
// Postgres is never asked. A "yes" is only probably right (false positives happen at the rate the filter was sized for),
// so it is checked against the users table, which has the last word. checkedDb says whether Postgres was needed.
export default async function usernameTaken({ redis, db }, name) {
  const maybe = await redis.sendCommand(['BF.EXISTS', 'bf:usernames', name]);
  if (Number(maybe) === 0) return { taken: false, checkedDb: false };
  const { rows } = await db.query('SELECT 1 FROM users WHERE handle = $1', [name]);
  return { taken: rows.length > 0, checkedDb: true };
}
