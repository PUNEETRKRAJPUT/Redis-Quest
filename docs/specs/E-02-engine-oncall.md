# E-02: engine, schema, UI and harness pieces Chapter 4b (on call) needs

**Goal.** Let a learner put the app under traffic on demand (so a planted fault shows up in `INFO`,
`SLOWLOG` and `CLIENT LIST`), let a level see that Redis went BUSY and that the learner killed the script,
let a traffic verifier judge Redis commands per request, and give checks a clean "does not contain".

**Depends on.** nothing (A-04 builds the faulty app slots in parallel; it does not touch these files).

**Files owned.**
- `engine/src/` except `engine/src/verify/slots.ts` (A-04's); mainly `server.ts`, `cli.ts`, `verify/traffic.ts`,
  `verify/assert.ts`, `verify/index.ts`, a new `load/ondemand.ts`; `engine/test/`
- `packages/shared/src/levels/` (schema and README-facing types), `packages/shared/src/levels/__tests__/`
- `ui/src/`, `ui/test/`
- `scripts/grade/grade.mjs`, `docs/grading.md`, `levels/README.md` (the field tables only)
- `scripts/check/E-02.sh`, `.env.e02` (gitignored: `PROXY_PORT=3600 REDIS_PORT=6396 PG_PORT=5438 INSIGHT_PORT=5546 ENGINE_DEV=1`, same as E-01's)
- `docs/handoffs/E-02.md`

**Must not touch.** `app/`, `engine/src/verify/slots.ts`, `runner/`, `levels/` (apart from `levels/README.md`),
`scenarios/`, `docker-compose.yml`, `docker/`, other checks, `docs/BUILD.md`. Compose project `quest-e02` only.

**Interfaces to honour.** `docs/handoffs/P0-09.md` (traffic verifier, `MetricsTap` window, scenario format),
`docs/handoffs/E-01.md` (events, the per-player verify guard `verifier.begin`, harness rules), `engine/src/load/run.ts`
(`runLoad`, `RunLoadOptions`), `engine/src/load/scenario.ts` (loading and caps), the WebSocket `level.event` shape.

**Work.**

1. **On-demand traffic.** `POST /api/load/start` body `{ scenario, durationSec (1..30), connections? (1..cap) }`:
   loads the scenario like the verifier does (same caps and `LOW_POWER`), runs it in the background against the
   app **as it is** (no slot switching, no baseline, no grading), under the verifier's per-player guard so it cannot
   overlap a verification (verify during a run answers the existing 409 `verify_in_progress`; make that message say
   "a verification or a traffic run is already running"). Answers `202 { scenario, durationSec, connections, startedAt, endsAt }`.
   `GET /api/load/status` → `{ running: boolean, scenario, startedAt, endsAt, last: { requests, rps, p99Ms, errors, status5xx } | null }`
   (`last` is the most recent finished run's numbers). `POST /api/load/stop` → stops a run early (autocannon's
   `stop`), `{ stopped: boolean }`. Emit `level.event` custom `load_started { scenario, durationSec }` when it starts
   and `load_finished { scenario, requests, rps, p99Ms, errors }` when it ends (also on stop), so a level can
   require "you ran the traffic" with `event custom load_finished` and `match: { scenario: ... }` (keys are looked
   up inside `data`, E-01). No baseline is recorded or touched.
2. **UI button.** On a level whose payload has `scenario`, beat 2 ("what already exists", where the pain panel is)
   shows "Run traffic: <scenario> (10 s)" (`data-testid="run-traffic"`), calls start with `durationSec: 10`,
   shows "running… <remaining> s" from status (poll status every second while running) and the last run's
   rps / p99 / errors when done, disabled with "wait for the verifier" on a 409. Unit test as E-01's switch
   (static markup plus the click handler against a fake route).
3. **CLI events.** In the CLI route (`server.ts`, where `cli_ping` is emitted): when a reply is an error whose text
   starts with `BUSY`, emit custom `redis_busy { command }`; when the command was `SCRIPT KILL` or `FUNCTION KILL`
   and the reply is a status `OK`, emit custom `script_killed { command }`. Make sure a `BUSY` error reply reaches
   the terminal as an error line (it may already), not a thrown 500. The engine's own client may be stuck behind a
   long script: confirm the CLI's behaviour during a 20 s read-only `EVAL` loop (run one with `redis-cli` in the
   check): the `PING` typed in the terminal should come back `BUSY ...` after `busy-reply-threshold` (5 s by
   default) rather than hang for 20 s, and `SCRIPT KILL` should answer `OK`. If node-redis's single connection makes
   the engine itself unusable during the script, say exactly what happens; do not paper over it.
4. **Traffic assertions.** Add `redis_per_request_lte` (absolute: the run window's `redisCommands / requests`
   from the app metrics the tap already sums) and `redis_calls_ratio_lte` (that number divided by the baseline's,
   a `BASELINE_RATIO_KEYS` member). Schema (`TRAFFIC_ASSERTION_KEYS`, refinements), `traffic.ts` evaluation and
   feedback text in the existing style, `levels/README.md` table row, unit tests next to the existing ones.
5. **`notContains`.** A redis-check assertion `notContains: <string>` that passes when the formatted reply does
   not contain the text (string replies such as `INFO commandstats`; lists are joined the way `contains` sees them).
   Schema (exactly one assertion kind rule), `assert.ts`, feedback `expected no "<text>"`, README row, tests.
   Also state in the handoff whether `matches` with a negative lookahead works on an `INFO` reply (test it), so
   content authors know both forms.
6. **Harness rules** (good solutions only, as E-01): custom `load_finished` with `match.scenario` → before verify,
   `POST /api/load/start { scenario, durationSec: 5 }` and poll status until it is not running; custom `script_killed`
   (and `redis_busy`, same dance): POST `/app/oncall/badges/recompute` (A-04's route; not awaited), sleep 5.5 s, run
   `PING` through `/api/cli` (expect a BUSY error, which emits `redis_busy`), then `SCRIPT KILL` through `/api/cli`
   (emits `script_killed`), then await the first request's end; a 404 from the route prints
   `NOTE script_killed: /app/oncall/badges/recompute not available (A-04 not merged)` and carries on. Document in
   `docs/grading.md` under "Events the harness produces".

**Acceptance check.** `scripts/check/E-02.sh` (bash 3.2, project `quest-e02`, scratch levels and progress, no
insight, `down -v` on exit): the stack up; `POST /api/load/start` with `toss-time-100` for 5 s → 202, status
shows running then a `last` with requests > 0, `load_started` and `load_finished` with the scenario in
`GET /api/events`; `stop` ends a 20 s run early; verify during a run → 409; a 20 s read-only `EVAL` loop started with
`docker compose -p quest-e02 exec -T redis redis-cli` in the background → `PING` via `/api/cli` answers BUSY within
~6 s and `redis_busy` appears in events, `SCRIPT KILL` via `/api/cli` → OK and `script_killed` appears; a scratch
code level whose traffic verifier uses `redis_per_request_lte` graded right/wrong with two learner files (a cache that
reads Redis once per request vs one that memoises in process); a scratch cli level with `notContains` on `INFO
commandstats` graded right/wrong; `example-cli` and `example-code` grade with no MISMATCH (regression); engine, shared
and ui vitest, `pnpm -r lint`, `pnpm format:check` green (format only your files; A-04's in-flight `app/` files may be
unformatted: print them as NOTE). Exit 0, print each thing verified.

**Handoff complete when.** the check passes; `docs/handoffs/E-02.md` has the route contracts, the event payloads,
the exact CLI behaviour during a long script, the assertion semantics and feedback strings, the harness rules, and
the check output.

**Model.** sonnet
