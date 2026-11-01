// Reference repair: a page view expires after a day instead of living in memory for ever.
export default async function recordView({ redis }, userId, matchId) {
  await redis.set(`view:${userId}:${matchId}`, new Date().toISOString(), { EX: 86400 });
  return { ok: true };
}
