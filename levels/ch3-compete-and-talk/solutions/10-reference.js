// Reference: one ball, two writes.
//  - PUBLISH on score:match:<matchId>: every subscriber connected right now gets it (the PUBLISH reply is how many).
//  - SET score:match:<matchId>:last with a one hour expiry: Pub/Sub keeps nothing, so a phone that opens the match
//    page a minute later has no way to learn the last ball from the channel. It reads this key instead.
const LAST_TTL_SECONDS = 3600;

export default async function publish({ redis }, matchId, ball) {
  const json = JSON.stringify({ ...ball, matchId });
  // Write the key first: anyone who reads it after seeing the message must find a ball at least that new.
  await redis.set(`score:match:${matchId}:last`, json, { expiration: { type: 'EX', value: LAST_TTL_SECONDS } });
  return redis.publish(`score:match:${matchId}`, json);
}
