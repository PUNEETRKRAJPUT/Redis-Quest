// Wrong: complete never looks at the token. Any worker can complete any job, including one that was reclaimed and handed to
// somebody else, so a slow worker that wakes up late finishes a job that is no longer its own.
import { randomBytes } from 'node:crypto';

const PENDING = 'queue:jobs:pending';
const PROCESSING = 'queue:jobs:processing';
const COMPLETED = 'queue:jobs:completed';
const FAILED = 'queue:jobs:failed';
const JOB_PREFIX = 'queue:jobs:job:';
const jobKey = (id) => `${JOB_PREFIX}${id}`;
const HISTORY = 50; // the docs' demo keeps the last 50 finished ids
const JOB_TTL_SECONDS = 3600; // finished job hashes clean themselves up

const COMPLETE = `
redis.call('LREM', KEYS[1], 1, ARGV[1])
redis.call('HSET', KEYS[3], 'status', 'completed', 'completed_at_ms', ARGV[4], 'result', ARGV[3])
redis.call('HDEL', KEYS[3], 'claim_token')
redis.call('LPUSH', KEYS[2], ARGV[1])
redis.call('LTRIM', KEYS[2], 0, tonumber(ARGV[5]) - 1)
redis.call('EXPIRE', KEYS[3], tonumber(ARGV[6]))
return 1`;

// Retry while attempts < maxAttempts (the job goes to the back of the line), otherwise give up.
const FAIL = `
local token = redis.call('HGET', KEYS[4], 'claim_token')
if not token or token ~= ARGV[2] then return 0 end
redis.call('LREM', KEYS[1], 1, ARGV[1])
redis.call('HSET', KEYS[4], 'last_error', ARGV[3])
redis.call('HDEL', KEYS[4], 'claim_token')
local attempts = tonumber(redis.call('HGET', KEYS[4], 'attempts')) or 0
if attempts < tonumber(ARGV[4]) then
  redis.call('HSET', KEYS[4], 'status', 'pending')
  redis.call('LPUSH', KEYS[2], ARGV[1])
  return 'retry'
end
redis.call('HSET', KEYS[4], 'status', 'failed')
redis.call('LPUSH', KEYS[3], ARGV[1])
redis.call('LTRIM', KEYS[3], 0, tonumber(ARGV[5]) - 1)
redis.call('EXPIRE', KEYS[4], tonumber(ARGV[6]))
return 'failed'`;

// A job is stuck when it was claimed at least visibilityMs ago. A job with no claimed_at_ms (a crash between BLMOVE and the
// stamp) is judged by enqueued_at_ms and gets twice as long. Reclaiming clears the token, so the old worker is fenced out.
const RECLAIM = `
local ids = redis.call('LRANGE', KEYS[1], 0, -1)
local now = tonumber(ARGV[1])
local visibility = tonumber(ARGV[2])
local moved = 0
for _, id in ipairs(ids) do
  local jk = ARGV[3] .. id
  local since = tonumber(redis.call('HGET', jk, 'claimed_at_ms'))
  local limit = visibility
  if not since then
    since = tonumber(redis.call('HGET', jk, 'enqueued_at_ms'))
    limit = visibility * 2
  end
  if since and now - since >= limit then
    redis.call('LREM', KEYS[1], 1, id)
    redis.call('RPUSH', KEYS[2], id)
    redis.call('HSET', jk, 'status', 'pending')
    redis.call('HDEL', jk, 'claim_token', 'claimed_at_ms')
    moved = moved + 1
  end
end
return moved`;

export async function enqueue({ redis }, payload) {
  const id = randomBytes(8).toString('hex');
  await redis
    .multi()
    .hSet(jobKey(id), {
      id,
      payload: JSON.stringify(payload),
      status: 'pending',
      attempts: '0',
      enqueued_at_ms: String(Date.now()),
    })
    .lPush(PENDING, id)
    .exec();
  return id;
}

export async function claim({ redis }, worker, timeoutMs) {
  // BLMOVE holds its connection until a job arrives or the timeout ends. On the shared client every other request of the app
  // would queue behind it, so a waiting worker takes a connection of its own: duplicate() starts closed, connect() it.
  const conn = redis.duplicate();
  await conn.connect();
  const id =
    timeoutMs > 0
      ? await conn.blMove(PENDING, PROCESSING, 'RIGHT', 'LEFT', timeoutMs / 1000)
      : await conn.lMove(PENDING, PROCESSING, 'RIGHT', 'LEFT');
  if (!id) return null;
  const token = randomBytes(16).toString('hex');
  const [, , job] = await redis
    .multi()
    .hSet(jobKey(id), { status: 'processing', claimed_at_ms: String(Date.now()), claim_token: token, worker })
    .hIncrBy(jobKey(id), 'attempts', 1)
    .hGetAll(jobKey(id))
    .exec();
  return { id, payload: JSON.parse(job.payload), token, attempts: Number(job.attempts) };
}

export async function complete({ redis }, id, token, result) {
  const done = await redis.eval(COMPLETE, {
    keys: [PROCESSING, COMPLETED, jobKey(id)],
    arguments: [id, token, JSON.stringify(result ?? null), String(Date.now()), String(HISTORY), String(JOB_TTL_SECONDS)],
  });
  return done === 1;
}

export async function fail({ redis }, id, token, error, maxAttempts) {
  const outcome = await redis.eval(FAIL, {
    keys: [PROCESSING, PENDING, FAILED, jobKey(id)],
    arguments: [id, token, String(error), String(maxAttempts), String(HISTORY), String(JOB_TTL_SECONDS)],
  });
  return outcome === 0 ? false : outcome;
}

export async function reclaim({ redis }, visibilityMs) {
  return redis.eval(RECLAIM, { keys: [PROCESSING, PENDING], arguments: [String(Date.now()), String(visibilityMs), JOB_PREFIX] });
}

export default enqueue;
