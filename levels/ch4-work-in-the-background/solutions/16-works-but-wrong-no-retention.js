// Works, but wrong: the series are created without RETENTION. Everything records and reads back correctly, but no sample is ever
// dropped, so every request ever made stays in Redis for good.
// Reference bundle: the ops wall's recorder and reader. Default export = record (the first slot), named exports = the slot names.
//
// Keys, one time series per metric and route (route key = the route with runs of spaces and slashes replaced by one "_"):
//   ts:requests:<route>   1 for every request, summed per bucket       ts:errors:<route>   1 for a 5xx, 0 otherwise, summed
//   ts:latency:<route>    the milliseconds of every request, averaged per bucket        td:latency   a t-digest of all latencies
// TS.CREATE is idempotent here (an "already exists" error is ignored). One TS.MADD writes the three samples per request.
// range asks for each series with ALIGN 0, so bucket boundaries stay on multiples of the bucket size however the window moves.
const routeKey = (route) => String(route).replace(/[ /]+/g, '_');

async function ensure(redis, command) {
  try {
    await redis.sendCommand(command);
  } catch (err) {
    if (!/already exists/i.test(String(err && err.message))) throw err;
  }
}

export async function record({ redis }, sample) {
  const route = routeKey(sample.route);
  const at = String(sample.at ?? Date.now());
  const requests = `ts:requests:${route}`;
  const errors = `ts:errors:${route}`;
  const latency = `ts:latency:${route}`;
  const series = (key, kind, policy) => [
    'TS.CREATE', key, 'DUPLICATE_POLICY', policy, 'LABELS', 'kind', kind, 'route', route,
  ];
  await Promise.all([
    ensure(redis, series(requests, 'requests', 'SUM')),
    ensure(redis, series(errors, 'errors', 'SUM')),
    ensure(redis, series(latency, 'latency', 'LAST')),
    ensure(redis, ['TDIGEST.CREATE', 'td:latency']),
  ]);
  await redis.sendCommand([
    'TS.MADD', requests, at, '1', errors, at, sample.status >= 500 ? '1' : '0', latency, at, String(sample.ms),
  ]);
  await redis.sendCommand(['TDIGEST.ADD', 'td:latency', String(sample.ms)]);
  return null;
}

async function rangeOf(redis, key, from, to, aggregation, bucketMs) {
  try {
    return await redis.sendCommand([
      'TS.RANGE', key, String(from), String(to), 'ALIGN', '0', 'AGGREGATION', aggregation, String(bucketMs),
    ]);
  } catch (err) {
    if (/does not exist/i.test(String(err && err.message))) return []; // a route nobody has recorded yet
    throw err;
  }
}

export async function range({ redis }, route, fromMs, toMs, bucketMs) {
  const r = routeKey(route);
  const [requests, errors, latency] = await Promise.all([
    rangeOf(redis, `ts:requests:${r}`, fromMs, toMs, 'sum', bucketMs),
    rangeOf(redis, `ts:errors:${r}`, fromMs, toMs, 'sum', bucketMs),
    rangeOf(redis, `ts:latency:${r}`, fromMs, toMs, 'avg', bucketMs),
  ]);
  const buckets = new Map();
  const bucket = (at) => {
    if (!buckets.has(at)) buckets.set(at, { at, requests: 0, errors: 0, avgMs: 0 });
    return buckets.get(at);
  };
  for (const [at, value] of requests) bucket(Number(at)).requests = Number(value);
  for (const [at, value] of errors) bucket(Number(at)).errors = Number(value);
  for (const [at, value] of latency) bucket(Number(at)).avgMs = Number(value);
  return { route, buckets: [...buckets.values()].sort((a, b) => a.at - b.at) };
}

export default record;
