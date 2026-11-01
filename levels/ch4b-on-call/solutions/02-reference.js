// Reference: spread one huge hash over `buckets` smaller ones (<key>:<n>), then UNLINK the original.
// HSCAN walks the hash a page at a time (COUNT 1000 asks for about a thousand fields per call), so no single command
// holds Redis for long; each page is written to its buckets in one pipeline (node-redis sends commands issued in the
// same tick together). The bucket of a field is the 32-bit FNV-1a hash of its name modulo the bucket count: plain
// application sharding, not a Redis hash slot. UNLINK removes the key without making the server do the freeing in the
// middle of your request, which is what a DEL of a three-lakh-field hash would do.
function bucketOf(field, buckets) {
  let h = 0x811c9dc5;
  for (let i = 0; i < field.length; i++) {
    h ^= field.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h % buckets;
}

export default async function splitBigKey({ redis }, key, buckets) {
  const written = new Set();
  let fields = 0;
  let cursor = '0';
  do {
    const page = await redis.hScan(key, cursor, { COUNT: 1000 });
    cursor = String(page.cursor);
    const byBucket = new Map();
    for (const { field, value } of page.entries) {
      const n = bucketOf(field, buckets);
      if (!byBucket.has(n)) byBucket.set(n, {});
      byBucket.get(n)[field] = value;
    }
    const writes = [];
    for (const [n, chunk] of byBucket) {
      writes.push(redis.hSet(`${key}:${n}`, chunk));
      written.add(n);
    }
    await Promise.all(writes);
    fields += page.entries.length;
  } while (cursor !== '0');
  await redis.unlink(key);
  return { fields, buckets: written.size };
}
