// Wrong: counts per minute in a sorted set, a hand-made time series. No retention, no aggregation, no labels, and the keys are not
// time series: TS.GET, TS.RANGE and TS.INFO refuse to read them. Latency is not even kept.
const minuteOf = (at) => Math.floor((at ?? Date.now()) / 60000) * 60000;
const routeKey = (route) => String(route).replace(/[ /]+/g, '_');

export async function record({ redis }, sample) {
  const key = `ts:requests:${routeKey(sample.route)}`;
  await redis.zIncrBy(key, 1, String(minuteOf(sample.at)));
  return null;
}

export async function range({ redis }, route, fromMs, toMs) {
  const rows = await redis.zRangeWithScores(`ts:requests:${routeKey(route)}`, 0, -1);
  const buckets = rows
    .map(({ value, score }) => ({ at: Number(value), requests: score, errors: 0, avgMs: 0 }))
    .filter((b) => b.at >= fromMs && b.at <= toMs);
  return { route, buckets };
}

export default record;
