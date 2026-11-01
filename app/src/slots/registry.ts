import * as b from './baselines.js';
import type { SlotDef } from './types.js';

/**
 * Every slot, declared once. A level names a slot; the engine activates it; the app loads `file` from the
 * learner's workspace and calls it instead of `baseline`. To add a slot, follow the rules in
 * docs/handoffs/P0-07.md ("Adding a slot"): add an entry here, a baseline in baselines.ts, and a route
 * (or an existing route) that calls `slots.call(name, ...args)`.
 */
export const SLOTS: readonly SlotDef[] = [
  {
    name: 'onboarding.registerUser',
    file: 'ch1/register.js',
    signature: '(deps, user)',
    returns: 'anything; { created: false } means the user already existed (409)',
    baseline: b.registerUser,
  },
  {
    name: 'cache.getPlayerStats',
    file: 'ch2/cache.js',
    signature: '(deps, playerId)',
    returns: 'the player_stats row as an object, or null when the player does not exist (404)',
    baseline: b.getPlayerStats,
  },
  {
    name: 'cache.invalidatePlayerStats',
    file: 'ch2/invalidate.js',
    signature: '(deps, playerId)',
    returns: 'anything (echoed as result)',
    baseline: b.invalidatePlayerStats,
  },
  {
    name: 'prefetch.getFixtures',
    file: 'ch2/prefetch.js',
    signature: '(deps)',
    returns: 'an array of scheduled and live matches',
    baseline: b.getFixtures,
  },
  {
    name: 'prefetch.bulkLoad',
    file: 'ch2/prefetch-bulk.js',
    signature: '(deps, rows)',
    returns:
      'anything (ignored); called once per instance when the slot is activated and on POST /app/prefetch/reload, rows = every matches row joined with team names',
    baseline: b.bulkLoadMatches,
  },
  {
    name: 'prefetch.applyChange',
    file: 'ch2/prefetch-apply.js',
    signature: '(deps, event)',
    returns:
      'anything (ignored); called per legacydb:changes entry, event = { aggregate, aggregateId, op, payload }',
    baseline: b.applyMatchChange,
  },
  {
    name: 'session.create',
    file: 'ch3/session-create.js',
    signature: '(deps, user)',
    returns: 'a non-empty session id string (set as cookie sid)',
    baseline: b.createSession,
  },
  {
    name: 'session.get',
    file: 'ch3/session-get.js',
    signature: '(deps, sid)',
    returns: 'an object with a string userId, or null when the session does not exist (401)',
    baseline: b.getSession,
  },
  {
    name: 'session.destroy',
    file: 'ch3/session-destroy.js',
    signature: '(deps, sid)',
    returns: 'anything (ignored); the session must be gone afterwards (POST /app/logout)',
    baseline: b.destroySession,
  },
  {
    name: 'session.destroyAll',
    file: 'ch3/session-destroy-all.js',
    signature: '(deps, userId)',
    returns:
      'anything (echoed as result); every session of the user must be gone (POST /app/logout-all)',
    baseline: b.destroyAllSessions,
  },
  {
    name: 'leaderboard.top',
    file: 'ch3/leaderboard.js',
    signature: '(deps, contestId, limit)',
    returns: 'an array of entry objects, best first (the route adds rank)',
    baseline: b.leaderboardTop,
  },
  {
    name: 'ratelimit.allow',
    file: 'ch3/ratelimit.js',
    signature: '(deps, userId)',
    returns: 'truthy to allow, falsy to reject (429); { allowed } also accepted',
    baseline: b.rateLimitAllow,
  },
];
