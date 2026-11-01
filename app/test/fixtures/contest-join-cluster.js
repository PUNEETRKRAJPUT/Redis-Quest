// Reference for slot contest.join on a Redis Cluster target (A-05; the single-node reference is contest-join.js).
// Two things change when the target is a cluster, and both are the lesson:
//   1. wallet:<u> and contest:<id>:entries hash to different slots, so one MULTI over both fails (CROSSSLOT when
//      both slots sit on one node, MOVED when they do not). Hash tags fix it: only the text inside {...} is
//      hashed, so {wallet:<u>} and {wallet:<u>}:joins:<contest> live in one slot, on one node.
//   2. The cluster client has no WATCH (a WATCH belongs to one connection to one node, and the client picks a
//      node per command), so the optimistic-locking loop of contest-join.js cannot be written. One Lua script
//      does check, debit and count as one atomic step on the node that owns the slot instead.
const JOIN = `
local balance = tonumber(redis.call('GET', KEYS[1]))
if balance == nil or balance < tonumber(ARGV[1]) then return 0 end
redis.call('DECRBY', KEYS[1], ARGV[1])
redis.call('INCR', KEYS[2])
return 1`;

export default async function join({ redis }, userId, contestId, fee) {
  const wallet = `{wallet:${userId}}`;
  const joins = `${wallet}:joins:${contestId}`;
  return (await redis.eval(JOIN, { keys: [wallet, joins], arguments: [String(fee)] })) === 1;
}
