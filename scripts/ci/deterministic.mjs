// Which levels the grader may judge on a machine of unknown speed (`scripts/grade/grade.mjs --deterministic`).
//
// A pull request is graded on a shared GitHub runner, not on the Apple Silicon Mac with the full compose stack. So
// only levels whose verdict cannot depend on the speed of the machine, or on Docker, are graded there; the others
// are SKIPPED with a printed reason and graded by hand by the maintainer (scripts/review-pr). A skip is never a
// failure; a MISMATCH on a level that was graded is.
//
// This file is pure (no I/O) so it can be unit tested. It lives in scripts/ci/ with the rest of D-01.

/** Level modes that can be graded without Docker. `ops` solutions are shell scripts that drive Compose. */
export const GRADED_MODES = ['cli', 'code', 'decision'];

/** Custom events that exist only when the compose profiles (replica, Sentinel, cluster) are really running. */
const PROFILE_EVENTS = ['redis_target_changed', 'sentinel_failover'];

/**
 * Why a level must not be graded deterministically, or null when it may be.
 * `level` is the validated level object the shared loader returns (`loaded.level`).
 * @param {{ mode: string, verify?: any[], interview?: any }} level
 * @returns {string | null}
 */
export function deterministicSkipReason(level) {
  if (!GRADED_MODES.includes(level.mode)) {
    return `mode ${level.mode}: its solutions are shell scripts that drive Docker Compose`;
  }
  if (level.mode === 'code' && level.interview?.pool) {
    return 'draws one of several earlier levels at random when it starts, and some of those need traffic';
  }
  for (const v of level.verify ?? []) {
    if (v.type === 'event') {
      if (v.kind === 'redis_disconnect' || v.kind === 'redis_reconnect') {
        return 'needs a real Redis outage';
      }
      if (v.kind === 'custom' && PROFILE_EVENTS.includes(String(v.match?.name))) {
        return 'needs the compose profiles (replica, Sentinel or cluster)';
      }
      if (v.kind === 'custom' && v.match?.name === 'load_finished') {
        return 'needs a timed load run';
      }
    }
    if (v.type === 'traffic') {
      const keys = Object.keys(v.assertions ?? {});
      const timing = keys.filter((k) => /^(p99_|rps_)/.test(k));
      if (v.baseline === true) {
        return `traffic check judged against a baseline measured on the same machine (${keys.join(', ')})`;
      }
      if (timing.length > 0) {
        return `traffic check about latency or throughput (${timing.join(', ')})`;
      }
      return `traffic check whose totals depend on how much load the machine can generate (${keys.join(', ')})`;
    }
  }
  return null;
}
