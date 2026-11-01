// Works, but wrong: create forgets the expiry. get happens to push an expiry out, so a session that is read once gets
// a TTL; one that is created and never read lives in Redis forever. Every abandoned login is a key that is never
// removed. Same four-in-one layout as the reference:
//   create      -> ch3/session-create.js       (deps, user)
//   get         -> ch3/session-get.js          (deps, sid)
//   destroy     -> ch3/session-destroy.js      (deps, sid)
//   destroyAll  -> ch3/session-destroy-all.js  (deps, userId)
// The default export below is create, so this file also works as ch3/session-create.js on its own.
import { randomBytes } from 'node:crypto';

const SESSION_TTL_SECONDS = 1800;

const sessionKey = (sid) => `session:${sid}`;
const userSessionsKey = (userId) => `user:${userId}:sessions`;

// The cookie holds only this opaque random id. 32 random bytes, URL-safe, no space, ";" or ",".
export async function create({ redis }, user) {
  const sid = randomBytes(32).toString('base64url');
  const key = sessionKey(sid);
  const now = new Date().toISOString();
  // The expiry is missing here.
  await redis
    .multi()
    .hSet(key, { user_id: user.id, created_at: now, last_seen_at: now })
    .sAdd(userSessionsKey(user.id), sid)
    .exec();
  return sid;
}

// Sliding expiration: every read of a live session pushes its expiry out again.
export async function get({ redis }, sid) {
  const key = sessionKey(sid);
  const session = await redis.hGetAll(key);
  if (!session.user_id) return null; // unknown, expired, or a leftover with no owner

  // EXPIRE sits in the same MULTI as the HSET, so even if the session was deleted a moment ago, whatever this
  // write leaves behind still carries a TTL and is ignored by the user_id test above.
  await redis
    .multi()
    .hSet(key, 'last_seen_at', new Date().toISOString())
    .expire(key, SESSION_TTL_SECONDS)
    .exec();
  return { userId: session.user_id, createdAt: session.created_at };
}

// Logout on this device: forget the session and take its id out of the user's set, so logout-all does not chase it.
export async function destroy({ redis }, sid) {
  const key = sessionKey(sid);
  const userId = await redis.hGet(key, 'user_id');
  const tx = redis.multi().del(key);
  if (userId) tx.sRem(userSessionsKey(userId), sid);
  await tx.exec();
}

// Logout everywhere: the per-user set is the index, so there is no scan over every session in Redis.
export async function destroyAll({ redis }, userId) {
  const setKey = userSessionsKey(userId);
  const sids = await redis.sMembers(setKey);
  if (sids.length === 0) return { destroyed: 0 };
  const tx = redis.multi();
  for (const sid of sids) tx.del(sessionKey(sid));
  // SREM of exactly the ids we just deleted, not DEL of the set: a login that lands in between stays listed.
  tx.sRem(setKey, sids);
  await tx.exec();
  return { destroyed: sids.length };
}

export default create;
