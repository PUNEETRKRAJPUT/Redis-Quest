// Wrong: the planted fault. KEYS <prefix>* walks the whole keyspace in one command. The count is right, but the
// command is the cron job's whole problem: Redis can serve nobody else while it runs (about 60 ms over half a
// million keys on this stack), and it shows up in INFO commandstats as cmdstat_keys.
export default async function countUsers({ redis }, prefix) {
  const keys = await redis.keys(`${prefix}*`);
  return keys.length;
}
