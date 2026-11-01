// Reference for slot ops.range: three TS.RANGE calls (requests sum, errors sum, latency avg), merged by bucket.
// ALIGN 0 makes bucket boundaries multiples of bucketMs (not of `from`), so a window that slides does not
// re-cut every bucket. A series that does not exist yet is an empty answer, not an error.
// routeKey is idempotent, so `route` may be the app's route key or the already converted form.
const routeKey = (route) => route.replace(/[ /]+/g, '_');

export default async function range({ redis }, route, fromMs, toMs, bucketMs) {
  const rk = routeKey(route);
  const get = async (key, type) => {
    try {
      return await redis.ts.range(key, fromMs, toMs, {
        ALIGN: 0,
        AGGREGATION: { type, timeBucket: bucketMs },
      });
    } catch (err) {
      if (/does not exist|not a TSDB key/i.test(String(err && err.message))) return [];
      throw err;
    }
  };
  const [requests, errors, latency] = await Promise.all([
    get(`ts:requests:${rk}`, 'SUM'),
    get(`ts:errors:${rk}`, 'SUM'),
    get(`ts:latency:${rk}`, 'AVG'),
  ]);
  const buckets = new Map();
  const at = (t) => {
    if (!buckets.has(t)) buckets.set(t, { at: t, requests: 0, errors: 0, avgMs: null });
    return buckets.get(t);
  };
  for (const { timestamp, value } of requests) at(timestamp).requests = value;
  for (const { timestamp, value } of errors) at(timestamp).errors = value;
  for (const { timestamp, value } of latency) at(timestamp).avgMs = Math.round(value * 1000) / 1000;
  return { route, buckets: [...buckets.values()].sort((a, b) => a.at - b.at) };
}
