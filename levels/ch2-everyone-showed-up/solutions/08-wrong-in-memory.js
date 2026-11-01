// Wrong: sessions in a Map inside the app process, which is level 3.1's baseline. It passes when one instance serves
// every request. Run two app instances and the login lands on one while the next request lands on the other, which
// has never heard of that sid; a restart forgets everybody; nothing ever expires. Redis holds none of it.
import { randomBytes } from 'node:crypto';

const sessions = new Map();

export async function create(_deps, user) {
  const sid = randomBytes(16).toString('hex');
  sessions.set(sid, { userId: user.id, createdAt: new Date().toISOString() });
  return sid;
}

export async function get(_deps, sid) {
  return sessions.get(sid) ?? null;
}

export async function destroy(_deps, sid) {
  sessions.delete(sid);
}

export async function destroyAll(_deps, userId) {
  for (const [sid, session] of sessions) if (session.userId === userId) sessions.delete(sid);
}

export default create;
