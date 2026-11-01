// Wrong: a Map inside the process, which is what the app does before you touch it. It counts correctly for one
// instance, but there is no ratelimit:fixed:<userId> key in Redis, so a second copy of the app has its own count,
// and a restart forgets every window.
const counts = new Map();

export default async function allow(_deps, userId) {
  const now = Date.now();
  const entry = counts.get(userId);
  if (!entry || now - entry.start >= 60_000) {
    counts.set(userId, { start: now, count: 1 });
    return true;
  }
  entry.count += 1;
  return entry.count <= 10;
}
