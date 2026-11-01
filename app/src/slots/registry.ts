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
    name: 'leaderboard.addPoints',
    file: 'ch3/leaderboard-add.js',
    signature: '(deps, contestId, teamId, delta)',
    returns:
      "the entry's new score as a number, or null when the entry does not exist (404 entry_not_found)",
    baseline: b.leaderboardAddPoints,
  },
  {
    name: 'leaderboard.rank',
    file: 'ch3/leaderboard-rank.js',
    signature: '(deps, contestId, teamId)',
    returns:
      '{ rank (1-based, best first), score, around: [{ teamId, score }] (up to two above and two below, the team included, best first) }, or null when the team is not in the contest (404)',
    baseline: b.leaderboardRank,
  },
  {
    name: 'leaderboard.recompute',
    file: 'ch3/leaderboard-recompute.js',
    signature: '(deps, rows)',
    returns:
      'anything (echoed as result); rows = [{ contestId, teamId, points }] for every entry of the given matches; the route times the call',
    baseline: b.leaderboardRecompute,
  },
  {
    name: 'contest.join',
    file: 'ch3/contest-join.js',
    signature: '(deps, userId, contestId, fee)',
    returns:
      'true when the entry fee was taken, false when the balance is too low (402); never takes the fee twice',
    baseline: b.contestJoin,
  },
  {
    name: 'ticker.publish',
    file: 'ch3/ticker-publish.js',
    signature: '(deps, matchId, ball)',
    returns:
      'anything (echoed as result; the natural value is the PUBLISH receiver count); the ball must reach channel score:match:<matchId>',
    baseline: b.tickerPublish,
  },
  {
    name: 'ratelimit.allow',
    file: 'ch3/ratelimit.js',
    signature: '(deps, userId)',
    returns: 'truthy to allow, falsy to reject (429); { allowed } also accepted',
    baseline: b.rateLimitAllow,
  },
  {
    name: 'points.consume',
    file: 'ch4/points-consume.js',
    signature: '(deps, matchId, consumer, count)',
    returns:
      '{ processed: string[] }: the entry ids this call processed and acked, in order (stream match:<matchId>:balls, group points)',
    baseline: b.pointsConsume,
  },
  {
    name: 'points.sweep',
    file: 'ch4/points-sweep.js',
    signature: '(deps, matchId, consumer, minIdleMs, maxDeliveries)',
    returns:
      '{ reclaimed: string[], deadLettered: string[] }: entry ids taken over from dead consumers and entry ids moved to match:<matchId>:balls:dead',
    baseline: b.pointsSweep,
  },
  {
    name: 'jobs.enqueue',
    file: 'ch4/jobs-enqueue.js',
    signature: '(deps, payload)',
    returns: 'the new job id (a non-empty string)',
    baseline: b.jobsEnqueue,
  },
  {
    name: 'jobs.claim',
    file: 'ch4/jobs-claim.js',
    signature: '(deps, worker, timeoutMs)',
    returns: '{ id, payload, token, attempts }, or null when nothing arrived within timeoutMs',
    baseline: b.jobsClaim,
  },
  {
    name: 'jobs.complete',
    file: 'ch4/jobs-complete.js',
    signature: '(deps, id, token, result)',
    returns:
      'true when this worker still owned the job and it is now completed, false otherwise (409 not_owner)',
    baseline: b.jobsComplete,
  },
  {
    name: 'jobs.fail',
    file: 'ch4/jobs-fail.js',
    signature: '(deps, id, token, error, maxAttempts)',
    returns:
      '"retry" (back to pending), "failed" (gave up) or false when this worker no longer owns the job (409 not_owner)',
    baseline: b.jobsFail,
  },
  {
    name: 'jobs.reclaim',
    file: 'ch4/jobs-reclaim.js',
    signature: '(deps, visibilityMs)',
    returns: 'the number of jobs moved from processing back to pending',
    baseline: b.jobsReclaim,
  },
  {
    name: 'jobs.schedule',
    file: 'ch4/jobs-schedule.js',
    signature: '(deps, payload, runAtMs)',
    returns:
      'the new job id; the job becomes pending once runAtMs (epoch ms) has passed and promoteDue has run',
    baseline: b.jobsSchedule,
  },
  {
    name: 'jobs.promoteDue',
    file: 'ch4/jobs-promote.js',
    signature: '(deps, nowMs)',
    returns: 'the number of jobs moved from queue:jobs:delayed to queue:jobs:pending',
    baseline: b.jobsPromoteDue,
  },
  {
    name: 'wallet.credit',
    file: 'ch4/wallet-credit.js',
    signature: '(deps, userId, amount, idempotencyKey)',
    returns: '{ credited: boolean, balance: number }; the same idempotencyKey must credit once',
    baseline: b.walletCredit,
  },
  {
    name: 'contest.claimLastSlot',
    file: 'ch4/contest-last-slot.js',
    signature: '(deps, contestId, userId)',
    returns:
      'true when this user got a slot, false when none was left (strictly a boolean; 409 contest_full)',
    baseline: b.contestClaimLastSlot,
  },
  {
    name: 'sessions.expireWithJitter',
    file: 'ch4/sessions-jitter.js',
    signature: '(deps, keys, baseSeconds, jitterSeconds)',
    returns: 'the number of keys given a TTL (a non-negative integer)',
    baseline: b.sessionsExpireWithJitter,
  },
  {
    name: 'users.usernameTaken',
    file: 'ch4/username-taken.js',
    signature: '(deps, name)',
    returns: '{ taken: boolean, checkedDb: boolean }; checkedDb says whether Postgres was asked',
    baseline: b.usernameTaken,
  },
  {
    name: 'ops.record',
    file: 'ch4/ops-record.js',
    signature: '(deps, sample)',
    returns:
      'anything (ignored); sample = { route, status, ms, at }, called in the background for every counted request while the slot is active',
    baseline: b.opsRecord,
  },
  {
    name: 'ops.range',
    file: 'ch4/ops-range.js',
    signature: '(deps, route, fromMs, toMs, bucketMs)',
    returns: '{ route, buckets: [{ at, requests, errors, avgMs }] }, oldest bucket first',
    baseline: b.opsRange,
  },
];
