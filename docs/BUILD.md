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
| F-03 | `.prettierignore` exists; add a `format:check` step to CI once the tree is stable | todo |
| F-04 (done, handoffs/F-04) | UI: ideal-way panel renders `ideal`, unlocks after pass or 3 attempts, "reveal anyway" via GET /api/levels/:id/ideal, line diff for code levels | done |
| F-05 | Schema: `show_me` should carry the key(s) to display (`{ component, keys }`), additive; UI stops hard-coding keys per level | todo |
| F-06 (done, handoffs/F-UI) | UI: clicking away from a focused terminal makes the page jump; fix for real users | todo |
| F-07 (done, handoffs/F-UI; engine side pending F-09) | UI: Redis Insight link should use the configured `INSIGHT_PORT`, not 5540 | todo |
| F-08 (done, handoffs/F-UI) | Playwright e2e: set `ALLOW_DEV_COMPLETE_FALLBACK=false` now that verify works | done |
| F-09 (done, handoffs/F-04) | Engine: `GET /health` exposes `insightUrl` | done |

## Content (after Phase 0)

| id | task | status |
|---|---|---|
| C0 | Chapter 0 levels (5) with reference + wrong solutions (spec: specs/C0, handoff: handoffs/C0) | done (content; live run pending P0-09) |
| C1 | Chapter 1 levels (16) (spec: specs/C1, handoff: handoffs/C1) | done (content; solutions verified against a private Redis by the author; engine live run pending P0-09) |
| C2a | Chapter 2 levels 2.1 to 2.4 (spec: specs/C2a, handoff: handoffs/C2a) | done (content; live grading pending G-01) |
| G-01 | Level grading harness: plays every declared solution through the engine, prints the truth table (spec: specs/G-01) | in progress |
| T1 | Five-tester playtest, findings, fixes | todo |

## Decisions log (newest first)
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
