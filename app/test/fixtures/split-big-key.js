// Reference repair: spread one huge hash over `buckets` smaller ones (<key>:<n>), then UNLINK the original.
// The bucket of a field is the 32-bit FNV-1a hash of the field name modulo the bucket count (not a Redis hash slot:
// this is plain application sharding). A 31-multiplier string hash was tried first and left the buckets 1.3k to 8.3k
// fields apart on 300,000 sequential names; FNV-1a spreads them evenly.
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
    const page = await redis.hScan(key, cursor, { COUNT: 5000 });
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
