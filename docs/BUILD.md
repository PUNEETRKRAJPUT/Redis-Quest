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
| A-03 | App plumbing for Chapter 4: stream consume/sweep, job queue slots and routes, idempotent credit, delayed jobs, contest lock, TTL jitter, Bloom username check, ops wall with a provided request hook (spec: specs/A-03, handoff: handoffs/A-03) | done (check 195 PASS twice) |
| C4 | Chapter 4 levels (16 + 3 interviews) (spec: specs/C4, handoff: handoffs/C4) | done (static check 435 PASS; graded through the engine by G-01: 53/53 after two harness timing fixes; tag v0.4.0) |
| E-02 | Engine for Chapter 4b: on-demand traffic (`POST /api/load/start`, UI button), `redis_busy` and `script_killed` CLI events, `redis_per_request_lte` and `redis_calls_ratio_lte` traffic assertions, `notContains`, harness rules (spec: specs/E-02, handoff: handoffs/E-02) | done (check 60 PASS; BUSY measured at ~5 s) |
| A-04 | App for Chapter 4b: the planted faults as baselines (KEYS cron, views without TTL, a Lua loop that freezes Redis, a client per request) and the two repair slots (split a big key, TTL sweep) (spec: specs/A-04, handoff: handoffs/A-04) | done (check 80 PASS twice; faults reproduce: KEYS in SLOWLOG, views without TTL, BUSY after 5 s and SCRIPT KILL, 9 to 208 connections) |
| C4b | Chapter 4b "On call": six diagnose-first levels and a checklist (spec: specs/C4b, handoff: handoffs/C4b) | done (static check 204 PASS; graded through the engine by G-01: 21/21 incl. the busy-then-kill dance and the connection bound; tag v0.4.1) |
| E-03 | Engine for Chapter 5: sentinel:// and cluster:// targets (shared `target.ts` helper), cluster routing in the CLI and checks, target switcher in the UI, `redis_target_changed` and `sentinel_failover` events, harness skips profile levels (spec: specs/E-03, handoff: handoffs/E-03) | done (check 69 PASS; failover 8.3 s, failback 7.1 s; committed together with A-05 because the shared learner index binds them) |
| A-05 | App and runner follow replica, sentinel and cluster targets; `deps.redisCached` (RESP3 client-side cache) (spec: specs/A-05, handoff: handoffs/A-05) | done (check 121 PASS twice; READONLY, CROSSSLOT and MOVED texts measured; no WATCH on sentinel or cluster clients) |
| C5 | Chapter 5 "Survive and scale" (14 levels) (spec: specs/C5, handoff: handoffs/C5) | done (static check 293 PASS; G-01: 40/40 on the single node; the four profile levels (crash, replica, sentinel, cluster) played by hand on the default stack: all right, the wrong cluster join wrong; tag v0.5.0) |
| E-04 | Engine for the Finale: interview pools (random draw, blank start, follow-up questions), verdict metrics kept in progress, portfolio page route and button, harness rules (spec: specs/E-04, handoff: handoffs/E-04) | done (check 112 PASS; the draw is sha256(player:level) over the entries not yet drawn; blank files backed up as <file>.before-<level>) |
| CF | Finale "The architect": three drawn mock interviews, the gauntlet, the neighbours, the code review, your story (spec: specs/CF, handoff: handoffs/CF) | done (static check 247 PASS; G-01: 37/37 with the drawn levels' solutions; mock interview one and your story played by hand; tag v1.0.0-rc1) |
| F-13 | Show-me panels for stream groups, time series, Bloom, Search and ACL; the impact log on What you built (spec: specs/F-13, handoff: handoffs/F-13) | done (check 45 PASS; also fixed the terminal-reply parser dropping entries from nested arrays of ten or more) |
| E-05 | `interview.questions` on the chapter interview levels; `--run-ops` grades ops levels against the harness's own stack (`G01_RUN_OPS=1`) (spec: specs/E-05, handoff: handoffs/E-05) | done (check 89 PASS; real ops levels of ch0, ch3 and ch5 graded by their scripts on an isolated stack, 12/12) |
| C-POL | The learner's README, tester docs on the current tag, follow-up questions on the nine chapter interviews (spec: specs/C-POL, handoff: handoffs/C-POL) | done (check 157 PASS; README with the eight-chapter table; tester docs on v1.0.0-rc2) |
| T1 | Five-tester playtest, findings, fixes (guide: docs/TESTING.md, message: docs/TESTER-MESSAGE.md, now on tag v1.0.0-rc2, the whole game) | invite ready; send when you choose |

## UI rebuild on Next.js (2026-11-19, merged to `main` the same day)
Puneet asked for the UI on Next.js with a far more interactive, game-like experience, and parked the 10-day
open-source plan. Brief: `docs/design/EXPERIENCE.md` ("Night match"). Shared rules for the screen tasks:
`specs/_wave2-common.md`. The work was done on a branch `ui-next` against an isolated stack and a shared
`next dev`, and fast-forwarded into `main` (one commit per task) after the full local run was green.

| ID | What | Status |
|---|---|---|
| F-14 | The UI runs on Next.js 16.4 App Router with full parity: eight real routes, GameShell, QuestLink, legacy hash redirect, Monaco through a Turbopack worker; the Vite app is removed (spec: specs/F-14, handoff: handoffs/F-14) | done (check: build lists the eight routes, lint, 106 tests) |
| F-15 | The stack serves the Next.js UI from its own `ui` service (standalone server, 3100, 384m); Caddy routes pages to it; the engine is API-only (spec: specs/F-15, handoff: handoffs/F-15) | done (check green against the rebuilt UI in the orchestrator's F-25 run) |
| F-16 | The "Night match" design system: tokens, self-hosted fonts, primitives, motion, synthesised sound, settings, the `/design` gallery (spec: specs/F-16, handoff: handoffs/F-16) | done (check 93 PASS) |
| F-17 | Scoreboard shell: HUD, command palette, shortcuts, rain delay, event toasts, route transitions (spec: specs/F-17, handoff: handoffs/F-17) | done (check green) |
| F-18 | The first five minutes: opening scene, name form with jersey, kick-off (spec: specs/F-18, handoff: handoffs/F-18) | done (check green) |
| F-19 | Season map and caps shelf (spec: specs/F-19, handoff: handoffs/F-19) | done (check green) |
| F-20 | Live chat thread (spec: specs/F-20, handoff: handoffs/F-20) | done (check green) |
| F-21 | The level as a match view: resizable panes, decision pending, celebration (spec: specs/F-21, handoff: handoffs/F-21) | done (check green; behaviour sent to the API unchanged) |
| F-22 | A terminal that helps: completion and argument hints from the server's own command docs, send-to-terminal in lessons (spec: specs/F-22, handoff: handoffs/F-22) | done (check green); the help stays dormant until E-06, because helper commands through `/api/cli` are not safe |
| F-23 | Show-me panels restyled and hands-on after a pass; the nets (spec: specs/F-23, handoff: handoffs/F-23) | done (check green) |
| F-24 | Tools pages and the career page (spec: specs/F-24, handoff: handoffs/F-24) | done (check green; two editor bugs fixed on the way) |
| F-25 | Integration: e2e tests play the new UI (welcome, map, levels, palette, routes, rain delay, terminal help on the real endpoints), UI checks, the legacy stylesheet removed, README images (spec: specs/F-25, handoff: handoffs/F-25) | done (orchestrator run: P0-10 and every UI check OK, each in its own compose project) |
| E-06 | The engine serves Redis's own command docs from one snapshot, so the terminal's completion never sends a helper command during a level (spec: specs/E-06, handoff: handoffs/E-06) | done (check green: 669 names, fifty requests send nothing to Redis) |
| G-03 | No check may act on the default compose project: `scripts/check/lib/isolate.sh`, six Phase 0 checks converted (P0-01, 02, 06, 07, 08, 11), a Docker-free tripwire in CI (spec: specs/G-03, handoff: handoffs/G-03) | done (each converted check passes beside a running `redis-quest` project and leaves it untouched; the tripwire catches all five original scripts) |

## The ten-day plan (started 2026-11-20)
Ten tasks, D-01 to D-10, each written on its own branch and merged into `main` on 2026-11-22 without pull
requests (Puneet's call). The status, what each day still owes and the steps to resume are in `docs/DAYS.md`;
shared rules in `specs/_days-common.md`. They were written **without local runs** at Puneet's request (the Mac
was short on memory and disk), so every one of them is unverified on a Mac until `docs/DAYS.md` says otherwise.

## Decisions log (newest first)
- 2026-11-22 Puneet dropped the pull requests: the ten day branches were merged into `main` (one merge commit per day, `ecf3925` to `cacbff6`, in the order D-10, D-01, D-03, D-04, D-08, D-05, D-06, D-07, D-09, D-02) and pushed directly, with local testing still on hold at his word. Nothing ran before the merge; CI on `main` is the first test the merged code has had. One fix came with it: `ci.yml` and `pr-verdict.yml` no longer treat `levels/community` as a campaign chapter. `main` is also the folder his own game starts from, so `docs/DAYS.md` lists what to keep off a real save until it is proven (the new `scripts/start`, Match Day, League scoring, the studio's play-test) and how to take one day back out (`git revert -m 1 <its merge commit>`).
- 2026-11-22 Puneet's own `./scripts/start` failed inside the image build: Corepack's download of pnpm was cut off mid-way (a network drop) and nothing retried it; both stages were downloading it at once, each inside its own `pnpm install`. `docker/node.Dockerfile` now downloads it once, in a `base` stage, with five attempts, and `.npmrc` raises pnpm's own `fetch-retries` from two to five. Written without a build at his request (no local runs): the first build of it is his next `./scripts/start`.
- 2026-11-22 Puneet chose to leave the 90 commits made under the Mac's global git identity as they are: no rewrite, no forced push. The ten pull requests are not open yet: GitHub lets only the owner or a collaborator open one here, and the `gh` login on this Mac is neither ("must be a collaborator", tried with his go-ahead). `docs/DAYS.md` carries ten links that open each form with its title and text filled in, for the owner's account.
- 2026-11-20 All ten day branches are written and pushed; none has run and no pull request is open (`docs/DAYS.md`). They merge together with no conflict as content (`git merge-tree`); the merged tree was never built. Found while preparing the pull requests: the repo-local git identity (decision of 2026-11-01, below) was lost in the fresh clone of 2026-11-02, so 90 commits since 2026-11-19 (32 on `main`, 58 on the day branches) carry the Mac's global identity. The setting is restored; rewriting those commits means force-pushing `main` and waits for Puneet. Lesson: `git config user.email` is checked before the first commit of a session (`CLAUDE.md`, Commits).
- 2026-11-20 Puneet asked for the whole ten-day plan at once as ten pull requests, built by Sonnet subagents, then for it to be resumable and code-only for now (no Docker, no dev server, no builds, no test runs locally). Base commit on `main`: extension points so branches do not collide (`engine/src/features/`, `ui/src/features/`, both inert until a feature turns itself on), `scripts/dev/check.sh` (type check and lint under one machine-wide lock), the ten specs and `docs/DAYS.md`. D-06 is stacked on D-05. The `v1.1.0-rc1` tag stays parked behind a fresh-clone start test.
- 2026-11-19 UI rebuild complete and merged: `main` fast-forwarded from `ui-next` and pushed on Puneet's go-ahead. Full local run GREEN on 0fa1f44 (22 checks, docs/ci-local.log; the FAIL line before it is an app test race the run exposed and that is now fixed: a test posted before the app had reloaded a rewritten learner file). G-01 in ops mode: 316 PASS, 0 MISMATCH, 6 skipped as before. P0-10 plays the new UI end to end, terminal help included, against the engine's real command-docs endpoints. Puneet's own game was moved to the new UI with `./scripts/start`: every container recreated (the base image tags had moved: Postgres 16.15 to 16.16, Redis still 8.10.3), save file byte-identical, mirror in sync. The check button reads "Verify my work" because 68 places in the level texts say "press Verify". Open follow-ups: a TCP health check for Postgres (handoffs/G-03), sound cues not yet heard by a person, Safari and Firefox untested.
- 2026-11-19 Incident: `scripts/check/P0-01.sh` called `docker compose` bare, so it acted on the default project, which on this Mac is Puneet's own game. It stopped his Redis and Postgres four times and ran the app and runner unit tests against them. Found by timestamp and removed: one test key (`t8:a-not-int-xx`) and six outbox rows; his save file, every game key and every other table were intact (row counts equal to a pristine seed). Rule from now on: a check that drives Compose calls `quest_isolate` (own project, ports, image tag, scratch directories; refuses the default project) or scopes every call with `-p`; `scripts/check/G-03.sh` enforces it in CI. `all.sh` and `ci-local.sh` were unsafe on a machine where someone plays the game until this fix.
- 2026-11-19 The UI moves to Next.js 16.4 (App Router) as its own compose service; all game data stays client-side (static shells, Cache Components, Partial Prefetching, the experimental offline mode), so the build needs no stack and the page survives a stack that is down. Agents read the version-matched docs bundled in `ui/node_modules/next/dist/docs/` (ui/AGENTS.md). The root `.gitignore` rule `logs/` had to become `/logs/` (it hid the new `/logs` route folder). The game stays Apple Silicon Mac-only; the 10-day open-source plan is parked, not cancelled.
- 2026-11-01 Tag v1.0.0-rc2: the polish backlog landed (five show-me panels and the impact log, follow-up questions on every interview level, the grader's ops mode, the learner README, tester docs on the tag). First time every level is machine-graded: G-01 in ops mode over eight chapters 315 PASS, 0 MISMATCH (the six skipped rows need a real outage or the cluster join and were played by hand). Full local run GREEN on 7dc6db5; CI green. Lessons: a topology reset after an ops level must keep the replica the next level starts from; a Sentinel left running demotes the returning master; count things by id, not by total, on a shared server; checks must follow the panels they assert.
- 2026-11-01 Tag v1.0.0-rc1: the Finale complete; every planned chapter is built (8 chapters, 96 levels). G-01 green over all of them (300 PASS, 0 MISMATCH); full local run GREEN on 894c311; CI green. The mock interview draws per player with a blank start and backups; the portfolio page quotes only stored numbers. Lessons: CI must validate the chapters together (pools reference earlier chapters); a test that counts a shared server's connections must track its own ids; learner-facing text never names a build task. Next: a tester round on the full game, then the polish backlog.
- 2026-11-01 Tag v0.5.0: Chapter 5 complete (14 levels; 89 levels in seven chapters). The game follows replica, sentinel and cluster targets end to end (engine, app, runner, terminal, verifier, UI switcher). G-01 green over seven chapters (263 PASS); full local run GREEN on 3e956f0. Lessons: the main redis must announce its hostname to Sentinel; node-redis follows a Sentinel failover only with a reconnect strategy that gives up; failback needs a 10 s settle after the rejoin; neither the sentinel nor the cluster client has WATCH; learner-facing text must never name a build task.
- 2026-11-01 Tag v0.4.1: Chapter 4b "On call" complete (7 levels). New plumbing: on-demand traffic from the level page, redis_busy / script_killed events, redis_per_request_lte, notContains. G-01 green over six chapters (223 PASS); full local run GREEN on 0f34140. Harness rule: on-demand traffic for a level runs with the solution's slots on (as a learner's run after the fix). Measured on this stack: a read-only Lua loop makes the terminal answer BUSY after ~5 s and the engine's own start/verify fail meanwhile; a client per request takes connected_clients from 9 to 208.
- 2026-11-01 Tag v0.4.0: Chapter 4 complete (19 files); G-01 green across five chapters (202 PASS, 0 MISMATCH); full local run GREEN (docs/ci-local.log, 8197233 plus a test-only edit). Harness lessons: an expired-key event needs the key set during the wait and then read (Redis's sampling can lag); FT.CREATE fills the index in the background, wait before counting; a level's checks must not race the engine. Check lessons: judge timings relative to a measured baseline, not absolute (P0-07); unit tests that fake load runs need a fake clock (verify-traffic).
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
