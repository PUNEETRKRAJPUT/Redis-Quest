// Wrong: the loop moved into one EVAL. It is bounded (no spin, no infinite loop) and the answer is right: two matches, two
// fields. But the whole walk is a single script, and a script holds the server until it ends: fine at two matches on a
// quiet night, a freeze at two thousand on the semi-final's. The redis check finds cmdstat_eval in INFO commandstats.
const SCRIPT = `
local cursor = '0'
local matches = 0
repeat
  local page = redis.call('SCAN', cursor, 'MATCH', 'lb:match:*', 'COUNT', 100, 'TYPE', 'zset')
  cursor = page[1]
  for _, key in ipairs(page[2]) do
    redis.call('HSET', 'badges:fifties', string.sub(key, 10), redis.call('ZCOUNT', key, 50, '+inf'))
    matches = matches + 1
  end
until cursor == '0'
return matches
`;

export default async function recomputeBadges({ redis }) {
  const matches = await redis.eval(SCRIPT, { keys: [], arguments: [] });
  return { matches };
}
