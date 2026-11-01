// Wrong: a "yes" from the filter is believed. A handle that was never saved, but is in the filter, is reported as taken:
// that is a false positive turned into a refusal, and a real student cannot register their own name.
export default async function usernameTaken({ redis }, name) {
  const maybe = await redis.sendCommand(['BF.EXISTS', 'bf:usernames', name]);
  return { taken: Number(maybe) === 1, checkedDb: false };
}
