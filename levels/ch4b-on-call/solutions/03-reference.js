// Reference: SCAN in pages instead of KEYS. Each call asks for about a thousand keys (COUNT 1000) and answers in
// microseconds, so Redis serves everyone else between pages; the loop ends when the cursor comes back as 0.
// KEYS does the same walk in one command that nobody can interrupt. SCAN has "limited guarantees" while keys come
// and go (a key can be seen twice), which is fine for a count that only has to be about right; here nothing changes.
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
