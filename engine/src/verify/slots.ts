// Slot name -> learner file in workspace/, for behavior verifiers (the runner needs a module path).
//
// This is a copy of the `name` and `file` columns of app/src/slots/registry.ts (P0-07), because the
// engine cannot import the app package. Keep the two in step until the list moves to @quest/shared
// (requested in docs/handoffs/P0-09.md); test/verify-slots.test.ts fails if this copy and the app's
// registry disagree.

export const SLOT_FILES: Readonly<Record<string, string>> = {
  'onboarding.registerUser': 'ch1/register.js',
  'cache.getPlayerStats': 'ch2/cache.js',
  'cache.invalidatePlayerStats': 'ch2/invalidate.js',
  'prefetch.getFixtures': 'ch2/prefetch.js',
  'session.create': 'ch3/session-create.js',
  'session.get': 'ch3/session-get.js',
  'prefetch.bulkLoad': 'ch2/prefetch-bulk.js',
  'prefetch.applyChange': 'ch2/prefetch-apply.js',
  'session.destroy': 'ch3/session-destroy.js',
  'session.destroyAll': 'ch3/session-destroy-all.js',
  'leaderboard.top': 'ch3/leaderboard.js',
  'ratelimit.allow': 'ch3/ratelimit.js',
  'leaderboard.addPoints': 'ch3/leaderboard-add.js',
  'leaderboard.rank': 'ch3/leaderboard-rank.js',
  'leaderboard.recompute': 'ch3/leaderboard-recompute.js',
  'contest.join': 'ch3/contest-join.js',
  'ticker.publish': 'ch3/ticker-publish.js',
};

export function slotFile(slot: string): string | undefined {
  return SLOT_FILES[slot];
}
