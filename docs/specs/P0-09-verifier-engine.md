# P0-09: Verifier engine

> DRAFT until the P0-05, P0-06, P0-07 and P0-08 handoffs land; type names and API paths below follow
> those specs and must be reconciled with what was actually built.

**Goal.** Turn a level's `verify` list into a verdict (`wrong`, `works_but_wrong`, `right`) with
per-check feedback, by running read-only Redis checks, antipattern checks, quizzes, event waits,
behavior runs through the runner, and traffic runs through autocannon against the app. This is where
"the game tells you honestly how you did" is implemented.

**Depends on.** P0-05, P0-06, P0-07, P0-08

**Files owned.**
- `engine/src/verify/` (new) and the wiring of `POST /api/levels/:id/verify` in the engine (replace the
  `not_implemented` stub from P0-06)
- `engine/src/load/` (autocannon scenario runner) and `scenarios/*.yaml` (+ `scenarios/README.md`)
- `scripts/check/P0-09.sh`

**Must not touch.** `packages/shared/src/levels/` (ask for a schema change in the handoff instead),
`app/`, `runner/`, `ui/`, `docker/`, `postgres/`.

**Interfaces to honour.**
- Input: the `VerifySpec[]` from `@quest/shared` plus a context `{ player, level, chapter, target, env }`
  for templating. Output: `{ verdict, checks: [{ index, type, ok, message, details }], durationMs,
  metrics? }`, persisted in the progress file under the level's `verdicts` with a timestamp.
- Verdict rule is the shared pure function `verdict(results)` from P0-05; do not reimplement it.
- `redis` and `antipattern` checks: run each `cmd` with `sendCommand` against the current target;
  compare with the assertion; a write command without `allowWrite` is refused at runtime too (defence
  in depth). Replies are normalised (integers as numbers, bulk as strings, nil as null, arrays as arrays)
  before assertions.
- `quiz`: compare the submitted option id(s) (from the request body) with `correct`.
- `event`: subscribe to the engine's own event bus (P0-06 WebSocket events) and resolve when `kind` and
  `match` fit within `timeoutMs`; `channel_message` subscribes to a Redis channel on a duplicated client.
- `behavior`: `POST ${RUNNER_URL}/run` with the slot's module path, the fixtures file, and the calls
  from `assertions`; evaluate `expect`, `expectError`, and `sideEffect` (a nested redis check) per call.
  `concurrency` passes through.
- `traffic`: load `scenarios/<id>.yaml` (`{ id, durationSec, connections, pipelining, users: { count,
  distribution: uniform|zipf, zipfSkew }, requests: [{ method, path, weight, userIdHeader }] }`), run
  autocannon from the engine against `${APP_URL}` with per-request `setupRequest` picking user ids and
  paths from the distribution, collect p50/p99/rps/non2xx/timeouts, read `dbQueries`, `redisCommands` and
  cache hit ratio from the engine's aggregated app metrics for the same window, and compare with the
  **baseline** for the scenario. Baseline semantics (ruled, matches the P0-05 schema): `baseline: true`
  means the ratio assertions are graded against a baseline run; the engine records that baseline itself
  the first time it is needed by running the same scenario with the level's learner slots deactivated
  (the unmodified app), storing it under `${PROGRESS_DIR}/baselines/<scenario>.json` with the app config
  it ran under; `POST /api/baselines/<scenario>/refresh` re-records. Levels never "record" anything.
  Absolute assertions (`hit_ratio_gte`, `error_rate_lte`, and the additive `db_queries_lte`, `p99_ms_lte`)
  need no baseline. Hard caps from `.env`: `LOAD_MAX_CONNECTIONS` (default 200),
  `LOAD_MAX_DURATION_SEC` (default 30); a `LOW_POWER=1` env halves both.
- Each check carries its own failure `message` from the level file; the engine appends the observed
  value ("expected zset, got list").
- Emit `level.event` WebSocket events as checks start and finish so the UI can show progress.
- Never run two verifications for the same player at once (409 on overlap).
- At startup, cross-check `READ_ONLY_COMMANDS` from `@quest/shared` against the live server's `COMMAND INFO` flags (`readonly`) for the current target and log any disagreement as a warning; the allowlist in the schema was written from memory, not from the docs digest.
- `antipattern` verifiers may be redis-shaped (`checks`) or behavior-shaped (`slot`, `fixtures`, `assertions`); a failing check or assertion is the hit, and its `message` is the feedback.

**Work.** Implement the above with vitest for assertion evaluation, reply normalisation, scenario
parsing and distribution sampling (deterministic with a seed), baseline comparison, and verdict wiring.
`scripts/check/P0-09.sh`: build; `docker compose up -d --build redis postgres engine app runner`; using the
`levels/_examples` levels: a `cli` level passes after the check script runs its reference `.redis` file
through `/api/cli`, fails before, and returns `works_but_wrong` after running its wrong solution; a `code`
level passes with the reference module copied into `workspace/`, `wrong` with an empty stub, and
`works_but_wrong` with the antipattern module; a `decision` level grades both ways; a traffic scenario
records a baseline against the baseline slot and then an improved ratio with the reference cache module;
`docker compose down`; clean the workspace copies.

**Acceptance check.** `scripts/check/P0-09.sh` exits 0.

**Handoff complete when.** check passes; `docs/handoffs/P0-09.md` written with the check output, the
scenario file format as built, baseline semantics, the caps, and the exact feedback strings a level author
can rely on; no files outside "Files owned" changed.

**Model.** opus. Grading correctness is the product.
