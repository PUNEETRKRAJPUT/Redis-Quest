// Reference for slot ticker.publish: one PUBLISH per ball on the match's channel. Returns the number of
// subscribers that received it right now (0 = nobody is listening, or a typo in the channel).
export default async function publish({ redis }, matchId, ball) {
  return redis.publish(`score:match:${matchId}`, JSON.stringify({ ...ball, matchId }));
}
