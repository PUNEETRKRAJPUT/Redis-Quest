// Reference for slot prefetch.applyChange (used by scripts/check/A-01.sh): keep cache:match:<id> in step
// with the matches table. DEL first on upsert so a dropped field cannot linger.
const asFields = (row) =>
  Object.fromEntries(Object.entries(row).map(([k, v]) => [k, v === null ? '' : String(v)]));

export default async function applyChange({ redis }, event) {
  if (event.aggregate !== 'matches') return;
  const key = `cache:match:${event.aggregateId}`;
  if (event.op === 'delete') {
    await redis.del(key);
    return;
  }
  await redis.multi().del(key).hSet(key, asFields(event.payload)).exec();
}
