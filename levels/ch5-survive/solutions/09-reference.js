// Reference: the contest join on a Redis Cluster. Two things change from Chapter 3:
//   1. wallet:<u> and contest:<id>:entries hash to different slots, so one step over both is refused (CROSSSLOT, or MOVED when the
//      keys are on different masters). A hash tag fixes it: only the text inside {...} is hashed, so {wallet:<u>} and
//      {wallet:<u>}:joins:<contest> share a slot and live on one master. The price: the count is per user per contest now,
//      and a contest-wide total has to be derived in a second step, never in this transaction.
//   2. The cluster client has no WATCH (a watch belongs to one connection to one node, and the client picks a node per command),
//      so the optimistic loop of Chapter 3 cannot be written. One Lua script does check, debit and count as one atomic step on the
//      master that owns the slot. Every key the script touches is passed in KEYS[], never built inside it.
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
