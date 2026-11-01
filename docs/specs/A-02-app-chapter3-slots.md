# A-02: app work Chapter 3 needs

**Goal.** Give Chapter 3 (rate limiting at scale, the real leaderboard, pipelined recompute, the wallet debit
under concurrency, the pub/sub ticker and the at-most-once drill) the routes, slots and one provided worker it
needs, plus a tiny script the learner runs to watch a limiter from the outside.

**Depends on.** nothing (E-01 runs in parallel and owns `engine/` except the one file named below; it does not
touch `app/`).

**Files owned.**
- `app/` (routes, slots registry, baselines, a new worker, tests, fixtures)
- `engine/src/verify/slots.ts` only (the engine's copy of the slot table; `engine/test/verify-slots.test.ts`
  fails when it disagrees with the app registry, so add the new rows there; touch nothing else in `engine/`)
- `scripts/hit.sh` (new)
- `scripts/check/A-02.sh`, `.env.a02` (gitignored; ports below)
- `docs/handoffs/A-02.md`

**Must not touch.** `engine/` beyond that one file (E-01 is editing `metrics.ts`, `server.ts`, tests),
`ui/`, `packages/`, `runner/`, `levels/`, `scenarios/`, `docker-compose.yml`, `docker/`, `scripts/grade/`,
other checks, `docs/BUILD.md`. Use compose project `quest-a02` only (never the default project, never `quest-e01`).

**Interfaces to honour.** `docs/handoffs/P0-07.md` ("Adding a slot", call semantics, metrics push),
`docs/handoffs/A-01.md` (workers, `callSlotInBackground`, fail-fast client), `app/src/workers/changes.ts` as the
pattern for a worker with its own connection, the existing routes `GET /app/leaderboard/:contestId` and
`GET /app/limits/ping` (keep both exactly as they are; the fixed-window in-process baseline limiter is what
level 3.1 observes), the engine's public `POST /api/events { kind: 'custom', name, data }` (exists today,
`engine/src/server.ts`), `ENGINE_URL` from the app config, `docs/handoffs/P0-04.md` (ids: contests 1 and 62 are
the two big open contests, live matches m-041 and m-042, users u-000010 etc., `wallets.balance`, `contests.entry_points`).

**Work.**

1. **Leaderboard slots** (zset per contest is the learner's job; every baseline is Postgres on purpose):
   - keep `leaderboard.top (deps, contestId, limit)`;
   - `leaderboard.addPoints (deps, contestId, teamId, delta)` → the new score as a number, or `null` when the
     entry does not exist. Route `POST /app/contests/:contestId/points` body `{ teamId, delta }` (delta a finite
     number, teamId a string ≤ 64) → `{ contestId, teamId, score }`, 404 `entry_not_found` on null. Baseline:
     `UPDATE contest_entries SET points = points + $3 WHERE contest_id = $1 AND fantasy_team_id = $2 RETURNING points`.
   - `leaderboard.rank (deps, contestId, teamId)` → `{ rank, score, around }` with `rank` 1-based best first,
     `around` = up to two entries above and two below including the team itself, each `{ teamId, score }`,
     ordered best first; or `null` when the team is not in the contest. Route
     `GET /app/leaderboard/:contestId/teams/:teamId` → the object, 404 `entry_not_found` on null. Baseline:
     a window function over `contest_entries` (`ORDER BY points DESC, id`).
   - `leaderboard.recompute (deps, rows)` with `rows = [{ contestId, teamId, points }]` → anything. Route
     `POST /app/leaderboards/recompute` body `{ matchIds: string[] }` (1 to 10 ids) loads
     `SELECT ce.contest_id, ce.fantasy_team_id, ce.points FROM contest_entries ce JOIN contests c ON c.id = ce.contest_id WHERE c.match_id = ANY($1)`
     once, calls the slot with every row, answers `{ ok, rows, ms, result }` where `ms` is the slot's own time.
     Baseline: nothing (returns `null`); say in the comment that Postgres already holds the truth and the level
     measures the learner's write path. Record in the handoff how many rows m-001 alone and m-001..m-008
     together give (the level wants about forty thousand).
2. **The wallet debit.** `contest.join (deps, userId, contestId, fee)` → `true` (joined, fee taken) or `false`
   (not enough balance). Route `POST /app/contests/:contestId/join` body `{ userId, fee? }` (fee integer 1..100000,
   default 10; the contest need not exist, levels use synthetic ids such as 9001) → 200 `{ joined: true }` or
   402 `{ error: 'insufficient_balance' }`. Baseline (correct, in Postgres, slow by design): one transaction,
   `UPDATE wallets SET balance = balance - $2 WHERE user_id = $1 AND balance >= $2 RETURNING balance`, and a
   `wallet_transactions` row (look at the table for the columns); `false` when no row was updated.
3. **The ticker.** `ticker.publish (deps, matchId, ball)` → anything (the natural return is the `PUBLISH`
   receiver count). Route `POST /app/matches/:matchId/balls` body `{ seq, over, ball, batter, runs, wicket?, commentary? }`
   (`seq` integer ≥ 1 required; the rest validated loosely, strings ≤ 200) → `{ ok, matchId, result }`.
   Baseline: a no-op that returns `0` and publishes nothing (so the level's event verifier only passes with the
   learner's code). Slot files: `ch3/leaderboard-add.js`, `ch3/leaderboard-rank.js`, `ch3/leaderboard-recompute.js`,
   `ch3/contest-join.js`, `ch3/ticker-publish.js`.
4. **The provided subscriber** (`app/src/workers/ticker.ts`, always on, per instance, own client like the change
   consumer): `SUBSCRIBE score:match:<id>` for every match whose status is `live` at boot (query once; m-041 and
   m-042 in the seed), exact channels, not patterns (`PUBSUB NUMSUB score:match:m-041` must count it). Per channel
   keep in memory `{ received, lastSeq, last, recent (ring of 20), gaps, malformed }`. A message is JSON with an
   integer `seq`; anything else counts as `malformed`. A message whose `seq` is greater than `lastSeq + 1` while
   `lastSeq` is known is a **gap**: `gaps += 1`, one warn log line, and POST `${ENGINE_URL}/api/events` with
   `{ kind: 'custom', name: 'ticker_gap', data: { matchId, instance, expected: lastSeq + 1, got: seq, missed: seq - lastSeq - 1 } }`
   (3 s timeout, fire and forget, one warn line on failure). Routes: `GET /app/ticker/:matchId` →
   `{ matchId, instance, subscribed, received, lastSeq, last, recent, gaps, malformed }` (404 `unknown_match` for a
   channel this instance never subscribed to); `POST /app/ticker/resubscribe` body `{ matchId, pauseMs }`
   (`pauseMs` 0..10000, default 1000) → unsubscribe that channel on this instance, wait, subscribe again, keep
   `lastSeq`, answer `{ ok, instance, pausedMs }` only after the new subscription is confirmed. Operational routes
   under `/app/ticker/*` are counted in metrics like any other route (they are game routes, not health).
5. **Instance header.** Every response carries `x-quest-instance: <hostname>` (add it where `x-quest-slots` is
   set), so a learner and `scripts/hit.sh` can see which instance answered.
6. **`scripts/hit.sh`** (bash 3.2): `scripts/hit.sh [count] [userId]`, defaults 30 and `u-000010`, reads
   `PROXY_PORT` from `.env` if present else 3000, sends the requests one after another to
   `GET /app/limits/ping` with `x-user-id`, prints one short line per request (`#7 200 instance=ab12`), then
   `allowed=<n> denied=<n> other=<n> instances=<k>` where `instances` counts distinct `x-quest-instance` values.
   Exit 0 whatever the counts; exit 2 when the proxy does not answer.
7. **Registry rows** in `app/src/slots/registry.ts` and the same names and files in `engine/src/verify/slots.ts`.
   Tests: registry rules, every new route against the baseline, the ticker worker (subscribe, receive, gap
   detection with a fake engine endpoint, resubscribe), `contest.join` baseline refuses when short.
   Fixtures for the check: reference learner files `app/test/fixtures/leaderboard-add.js` (`ZINCRBY lb:contest:<id>`),
   `leaderboard-rank.js` (`ZREVRANK` + `ZRANGE ... REV` window), `leaderboard-top.js`, `leaderboard-recompute.js`
   (`multi()` + `execAsPipeline()` in batches of 5000), `contest-join.js` (WATCH on a `deps.redis.duplicate()`
   that the learner `connect()`s, retry on `WatchError`, `wallet:<userId>` string and `INCR contest:<id>:entries`
   in the MULTI), `ticker-publish.js` (`PUBLISH score:match:<id> JSON.stringify({...ball, matchId})`). Write in the
   handoff exactly what `multi().exec()` does after a failed WATCH in this node-redis (throws `WatchError`, or
   returns null; test it), and whether a duplicate made from the learner's proxied client needs an explicit
   `connect()` (read `packages/shared/src/learner/counting.ts`; test it on the runner path too if you can, else say so).

**Acceptance check.** `scripts/check/A-02.sh`, bash 3.2, compose project `quest-a02` with `.env.a02`
(`PROXY_PORT=3700 REDIS_PORT=6397 PG_PORT=5439 INSIGHT_PORT=5547`), scratch levels (`example-cli`) and progress like
`A-01.sh`, no insight, refuses to overwrite existing `workspace/ch3/*.js`, `down -v` on exit; must:
- baseline: `POST /app/contests/1/points` for a real entry of contest 1 → 200 with a number, unknown team → 404;
  `GET /app/leaderboard/1/teams/<that team>` → rank and a 5-entry `around` (or fewer at the edges);
  `POST /app/leaderboards/recompute {matchIds:[m-001]}` → 200 and `rows` ≥ 1000 (print the number, and the number
  for m-001..m-008); `POST /app/contests/9001/join {userId:u-000010}` → 200 then `psql` shows the balance 10 lower and
  one new ledger row; with `fee: 100000` → 402; `GET /app/ticker/m-041` → `subscribed: true`, `received: 0`;
  `POST /app/matches/m-041/balls` with the baseline → `result: 0` and `received` still 0; publish through
  `docker compose -p quest-a02 exec -T redis redis-cli PUBLISH score:match:m-041 '{"seq":1,"over":1,"ball":1,"runs":4}'`
  → `received: 1`, `lastSeq: 1`; the gap dance (resubscribe in the background with `pauseMs: 1000`, PUBLISH seq 2
  and 3 during the pause, seq 4 after) → `gaps: 1` and `GET /api/events` on the engine lists `ticker_gap` with
  `missed: 2` within 3 s; `PUBSUB NUMSUB score:match:m-041` ≥ 1 via redis-cli;
- `scripts/hit.sh 30` against port 3700 (`PROXY_PORT=3700 scripts/hit.sh 30`) → `allowed=10 denied=20 instances=1`;
  `--scale app=2` → `hit.sh 30` → allowed between 14 and 20, `instances=2`; back to 1 instance for the rest;
- learner path: copy each fixture to its `workspace/ch3/` file, `PUT /api/slots` for the five slots, seed
  `lb:contest:9001` with 1000 members via redis-cli (`EVAL` loop), then `top`, `points`, `rank` through the routes
  agree with the zset; `SET wallet:u-000010 100` then 50 parallel joins (`xargs -P 50`) at fee 10 → exactly 10 `200`s,
  40 `402`s, `GET wallet:u-000010` = `0`, `contest:9001:entries` = `10`; `POST /app/matches/m-041/balls` with the
  reference publish → `result` ≥ 1 and the ticker `received` rises by one;
- `pnpm --filter @quest/app test`, app lint, `pnpm format:check` green (format only your own files); engine
  `verify-slots` test green (`pnpm --filter @quest/engine test -- verify-slots` or the whole engine suite);
- exit 0 and print each thing it verified.

**Handoff complete when.** the check passes on this Mac; `docs/handoffs/A-02.md` holds the new slot table with
signatures and return contracts, every new route with its body and responses, the ticker message format and the
`ticker_gap` payload, the WATCH facts above, the row counts, and the full check output; nothing outside
"Files owned" changed.

**Model.** sonnet
