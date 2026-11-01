// Reference for slot prefetch.bulkLoad (used by scripts/check/A-01.sh): one pipelined round trip of
// DEL + HSET per match; nothing reads the cache while it loads, so non-atomic is fine.
export default async function bulkLoad({ redis }, rows) {
  const pipeline = redis.multi();
  for (const row of rows) {
    const key = `cache:match:${row.id}`;
    pipeline.del(key);
    pipeline.hSet(
      key,
      Object.fromEntries(Object.entries(row).map(([k, v]) => [k, v === null ? '' : String(v)])),
    );
  }
  await pipeline.execAsPipeline();
}
