// Reference for slot ops.record: one sample per request into Redis time series.
//   routeKey(route) = route.replace(/[ /]+/g, '_')   'GET /app/players/:id/stats' -> 'GET_app_players_:id_stats'
//   ts:requests:<rk>   value 1 per request (sum per bucket = requests)
//   ts:errors:<rk>     value 1 per 5xx    (sum per bucket = errors)
//   ts:latency:<rk>    the request's ms   (avg per bucket)
//   td:latency         a t-digest of every latency, for percentiles
// TS.MADD never creates a key and a missing key comes back as an error object INSIDE the reply array (nothing is
// thrown), so look at the replies. DUPLICATE_POLICY SUM makes two requests in the same millisecond add up instead
// of the second being refused. RETENTION trims old samples by itself; there is nothing to EXPIRE.
const routeKey = (route) => route.replace(/[ /]+/g, '_');
const DAY_MS = 86_400_000;

function items(rk, s) {
  const list = [
    { key: `ts:requests:${rk}`, timestamp: s.at, value: 1 },
    { key: `ts:latency:${rk}`, timestamp: s.at, value: s.ms },
  ];
  if (s.status >= 500) list.push({ key: `ts:errors:${rk}`, timestamp: s.at, value: 1 });
  return list;
}

async function create(redis, key, kind, rk, policy) {
  try {
    await redis.ts.create(key, {
      RETENTION: DAY_MS,
      DUPLICATE_POLICY: policy,
      LABELS: { kind, route: rk },
    });
  } catch (err) {
    if (!/already exists/.test(String(err && err.message))) throw err;
  }
}

export default async function record({ redis }, sample) {
  const rk = routeKey(sample.route);
  const list = items(rk, sample);
  const replies = await redis.ts.mAdd(list);
  // TS.MADD applies each item on its own: a retry must resend only the items that failed, or the ones that
  // made it (another request may have created some of the keys already) would be counted twice.
  const failed = list.filter((_, i) => replies[i] instanceof Error);
  if (failed.length > 0) {
    await create(redis, `ts:requests:${rk}`, 'requests', rk, 'SUM');
    await create(redis, `ts:errors:${rk}`, 'errors', rk, 'SUM');
    await create(redis, `ts:latency:${rk}`, 'latency', rk, 'LAST');
    const again = await redis.ts.mAdd(failed);
    const bad = again.find((r) => r instanceof Error);
    if (bad) throw bad;
  }
  try {
    await redis.tDigest.add('td:latency', [sample.ms]);
  } catch (err) {
    if (!/does not exist/i.test(String(err && err.message))) throw err;
    try {
      await redis.tDigest.create('td:latency');
    } catch (e) {
      if (!/already exists/i.test(String(e && e.message))) throw e;
    }
    await redis.tDigest.add('td:latency', [sample.ms]);
  }
  return null;
}
