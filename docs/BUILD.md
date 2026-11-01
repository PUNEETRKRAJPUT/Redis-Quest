# Build board

The first file any session reads. Status is changed **only by the orchestrating session**, after it
has run the task's check itself. Statuses: `todo` · `in progress` · `blocked` · `done`.

## Milestone 1 (what testers get first)
Phase 0 platform, Chapter 0 (5 levels), Chapter 1 (16 levels), and Chapter 2 levels 2.1 to 2.4
(pain, cache-aside, invalidation, stampede). Those four levels are in because they are the only way to
prove the slot mechanism, Postgres, traffic grading and the three verdicts before real beginners play.
Then five testers, then Chapters 2 (rest) to 5 and the finale.

## How to resume after a session limit
1. Read this file. 2. Run `scripts/check/all.sh`; believe it over the board. 3. Read
`.claude-session-cache.md`. 4. Continue from the first task that is `in progress`, then `todo`, in
wave order. Specs are in `docs/specs/`, handoffs in `docs/handoffs/`.

## Phase 0: platform (complete on 2026-11-01; every check run by the orchestrator)

| id | task | wave | status | model | spec | check | handoff |
|---|---|---|---|---|---|---|---|
| P0-01 | Repo skeleton: pnpm workspace, TS base, lint, package layout | 1 | done | sonnet | specs/P0-01 | check/P0-01.sh | handoffs/P0-01 |
| P0-02 | Docker: node Dockerfile, compose, Caddyfile, start + preflight scripts | 2 | done | sonnet | specs/P0-02 | check/P0-02.sh | handoffs/P0-02 |
| P0-03 | Fiction bible | 1 | done | sonnet | specs/P0-03 | check/P0-03.sh | handoffs/P0-03 |
| P0-04 | Postgres schema, seed generator, outbox triggers, slow query | 2 | done | sonnet | specs/P0-04 | check/P0-04.sh | handoffs/P0-04 |
| P0-05 | Level file schema, loader, validator | 2 | done | opus | specs/P0-05 | check/P0-05.sh | handoffs/P0-05 |
| P0-06 | Engine skeleton: health, progress file + Redis mirror, WebSocket, CLI proxy | 3 | done | sonnet | specs/P0-06 | check/P0-06.sh | handoffs/P0-06 |
| P0-07 | App skeleton: baseline routes, slot registry, target switching | 3 | done | opus | specs/P0-07 | check/P0-07.sh | handoffs/P0-07 |
| P0-08 | Runner: load workspace module, call with deps, metrics, crash isolation | 3 | done | sonnet | specs/P0-08 | check/P0-08.sh | handoffs/P0-08 |
| P0-09 | Verifier engine: redis, antipattern, quiz, event; traffic + behavior wiring | 4 | done | opus | specs/P0-09 | check/P0-09.sh | handoffs/P0-09 |
| P0-10 | UI shell: chapter map, level view (seven beats), terminal, editor, logs, show-me | 4 | done | sonnet | specs/P0-10 | check/P0-10.sh | handoffs/P0-10 |
| P0-11 | Redis Insight auto-provisioning via its API | 3 | done | sonnet | specs/P0-11 | check/P0-11.sh | handoffs/P0-11 |
| P0-12 | CI: build, lint, level validation, checks, Playwright Chapter 0 | 5 | done (green run 41255059415; Playwright hook filled by P0-10) | sonnet | specs/P0-12 | check/P0-12.sh | handoffs/P0-12 |

Waves run in order; tasks within a wave run in parallel because they own disjoint files. A task may
start early if everything it depends on is `done`.

## Follow-ups (small, not blocking)

| id | task | status |
|---|---|---|
| F-01 (done, handoffs/F-01) | Caddy: dynamic A-record upstreams for `app`, round robin; keep-alive restored (`APP_MAX_REQUESTS_PER_SOCKET=0`) | done |
| F-02 | Engine metrics aggregate sums `dbQueries` and `redisCommands` | done |
| F-03 (done) | Code tree formatted once; `pnpm format:check` runs in CI; content, data, docs and workflows are ignored | done |
| F-04 (done, handoffs/F-04) | UI: ideal-way panel renders `ideal`, unlocks after pass or 3 attempts, "reveal anyway" via GET /api/levels/:id/ideal, line diff for code levels | done |
| F-05 (done, handoffs/F-05) | `show_me` is `{ component, keys, title? }`; all 27 levels declare their keys; engine renders the templates; UI's hard-coded key table removed | done |
| F-10 (done, handoffs/F-10) | UI: `stats_latency_panel` and `otp_limiter_panel` implemented; 429s are not counted by the app's metrics yet (a later app follow-up) | done |
| F-11 (done) | App pushes `denied` per route; engine aggregate sums it | done |
| F-06 (done, handoffs/F-UI) | UI: clicking away from a focused terminal makes the page jump; fix for real users | todo |
| F-07 (done, handoffs/F-UI; engine side pending F-09) | UI: Redis Insight link should use the configured `INSIGHT_PORT`, not 5540 | todo |
| F-08 (done, handoffs/F-UI) | Playwright e2e: set `ALLOW_DEV_COMPLETE_FALLBACK=false` now that verify works | done |
| F-09 (done, handoffs/F-04) | Engine: `GET /health` exposes `insightUrl` | done |

## Content (after Phase 0)

| id | task | status |
|---|---|---|
| C0 | Chapter 0 levels (5) with reference + wrong solutions (spec: specs/C0, handoff: handoffs/C0) | done (cli levels graded by G-01; ops levels proven by the UI e2e) |
| C1 | Chapter 1 levels (16) (spec: specs/C1, handoff: handoffs/C1) | done (graded through the engine by G-01: 52/52) |
| C2a | Chapter 2 levels 2.1 to 2.4 (spec: specs/C2a, handoff: handoffs/C2a) | done (graded by G-01: 13/13 including traffic) |
| G-01 | Level grading harness: plays every declared solution through the engine, prints the truth table (spec: specs/G-01, handoff: handoffs/G-01) | done (all three bugs fixed; ch1 re-graded 52/52) |
| A-01 (done, handoffs/A-01) | App: outbox drainer to `legacydb:changes`, prefetch bulkLoad/applyChange slots with a provided consumer, session destroy slots and logout routes, fail-fast learner Redis client (2 s), 429 counting | done |
| F-12 (done, handoffs/F-12) | Interview mode: `interview` block in the schema, countdown and hint cost in engine and UI, example level | done |
| C2b | Chapter 2 levels 2.5 to 2.11 (spec: specs/C2b, handoff: handoffs/C2b) | done (every solution graded through the engine; level 10 by hand with a real outage; tag v0.2.0) |
| E-01 | Engine, UI and harness plumbing for Chapter 3: `service_scaled` emitter, "Run my code in the app" switch, harness rules for channel, scale and ticker_gap events (spec: specs/E-01, handoff: handoffs/E-01) | done (check 38 PASS; scratch chapter 6/6; examples 9/9) |
| A-02 | App plumbing for Chapter 3: leaderboard addPoints/rank/recompute, contest.join, ticker publish slot and provided subscriber with gap detection, `x-quest-instance`, `scripts/hit.sh` (spec: specs/A-02, handoff: handoffs/A-02) | done (check 101 PASS; scale=2 lets 20 through; ticker_gap missed 2; 40,098 recompute rows in 124 ms) |
| C3 | Chapter 3 levels (15) (spec: specs/C3, handoff: handoffs/C3) | done (static check 302 PASS; graded through the engine by G-01: 43/43 incl. both traffic-decided wrongs, pub/sub and ticker_gap events; 3.1 by hand: 10 then 20 allowed, scale event seen; switch verified in a browser) |
| A-03 | App plumbing for Chapter 4: stream consume/sweep, job queue slots and routes, idempotent credit, delayed jobs, contest lock, TTL jitter, Bloom username check, ops wall with a provided request hook (spec: specs/A-03) | in progress |
| C4 | Chapter 4 levels (16 + 3 interviews) (spec: specs/C4) | in progress (parallel with A-03) |
| T1 | Five-tester playtest, findings, fixes (guide: docs/TESTING.md, message: docs/TESTER-MESSAGE.md, tag v0.1.0) | started 2026-11-01 |

## Decisions log (newest first)
- 2026-11-01 Tag v0.3.0: Chapter 3 complete; full local run GREEN (docs/ci-local.log, the PASS on 7f664a5 plus the two check fixes in the tagged commit). Two environmental lessons: the preflight needs 10 GB free (prune Docker build cache and per-check images), and checks that use the default project must not assume a fresh Redis, because it persists now (P0-06 deletes the welcome gift first). Runner vitest gets a 20 s test timeout like the app (a CI runner took 5.07 s on a 5 s default).
- 2026-11-01 Chapter 3 complete (15 levels). New plumbing: `service_scaled` event, "Run my code in the app" switch (POST /api/levels/:id/slots), harness produces live events for good solutions only. The grading harness now SKIPs levels that need a real Redis outage (ch2-10) instead of reporting a mismatch; they are graded by hand. Fixed a timer leak in createLearnerDeps' closeRedis (ClientClosedError after every closed duplicate).
- 2026-11-01 Tag v0.2.0: Chapter 2 complete; full local run GREEN at fb09c79 (docs/ci-local.log).
- 2026-11-01 Chapter 2 complete (13 levels). Live grading found: 4xx must count as answered in the traffic verifier; ops levels must restore Redis config; a cli level cannot depend on a workspace file from an earlier level.
- 2026-11-01 Full local run GREEN at 4fa4283 (ALL CHECKS PASSED, docs/ci-local.log). It surfaced four stale check assumptions and one real app bug (bind-mount poller lag; fixed with a throttled request-path stat). Content proven by the grading harness: ch1 52/52, ch2a 13/13, ch0 cli levels, examples. Fresh-clone `./scripts/start` verified.
- 2026-11-01 Phase 0 complete: 12/12 tasks done, CI green, Chapter 0 playable end to end in a browser with real verdicts. Next: C2a, fresh-clone run, ci-local log, F-04/F-05, then the five-tester playtest (T1).
- 2026-11-01 Default Redis now persists (RDB 60/1000 + AOF everysec) so Chapter 0.5 is honest; the `crash` profile is the no-persistence instance for Chapter 5. Verifier grades traffic relative to an engine-recorded baseline; traffic runs last and only after behavior passed on the runner.
- 2026-11-01 CI green on GitHub (fast job with redis/postgres service containers; mac job self-skips). Lockfile rule: HEAD's lockfile must match committed manifests; commit package.json and lockfile together; never commit via plumbing without resetting the index afterwards.
- 2026-11-01 Engine refuses to start on invalid levels by design; content agents must keep chapters valid at every save (write level files before listing them in chapter.yaml).
- 2026-11-01 Schema rulings: `traffic.baseline: true` means graded against a baseline the engine records itself (scenario run with the learner's slots off); antipattern checks describe the healthy state and a failing check is the hit; behavior assertions have `repeat`/`expectCount`; antipattern may be behavior-shaped (additive change requested); decision `wrong` entries use `option:`.
- 2026-11-01 Seed is committed gzipped (`002-seed.sql.gz`, 11 MB); the Postgres image loads it natively. `player_stats()` p50 measured 175-290 ms here.
- 2026-11-01 Verified: arm64 `redis:8` (8.10.3) loads search, ReJSON, timeseries, bf with no flags. Docker Desktop here has 7.7 GiB. `.dockerignore` lives next to the Dockerfile.
- 2026-11-01 League is the Nukkad Cricket League (NCL), 8 franchises, hot players p-028, p-101, p-151.
- 2026-11-01 Milestone 1 = Phase 0 + Ch0 + Ch1 + Ch2.1–2.4. Fictional league. macOS Apple Silicon 16 GB
  only. Engine/app split. Progress file is the source of truth. MIT licence. Repo-local git identity is
  the GitHub noreply address.
