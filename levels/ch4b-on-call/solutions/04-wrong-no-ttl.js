// Wrong: the planted fault and a sweep that does nothing. recordView still writes the view with no expiry, and addTtls
// answers 0 without giving anything a deadline, so the thousand old keys stay immortal and the behavior check fails.
export async function recordView({ redis }, userId, matchId) {
  await redis.set(`view:${userId}:${matchId}`, new Date().toISOString());
  return { ok: true };
}

export async function addTtls() {
  return 0;
}

export default recordView;
