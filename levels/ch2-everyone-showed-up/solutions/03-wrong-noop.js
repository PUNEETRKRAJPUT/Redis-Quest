// Wrong: does nothing, so the stale hash lives until its TTL runs out.
export default async function invalidatePlayerStats() {
  return null;
}
