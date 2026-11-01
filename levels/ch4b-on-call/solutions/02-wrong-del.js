// Wrong: the split is right (HSCAN pages, a pipelined write per page), but the original is removed with DEL. On this stack a
// DEL of the three-lakh-field hash holds the server for about 10 ms; UNLINK of the same hash took 7 to 30 microseconds. The redis check
// looks for cmdstat_unlink in INFO commandstats and finds none.
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
  await redis.del(key);
  return { fields, buckets: written.size };
}
