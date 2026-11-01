# Grading levels: how to use the harness while writing content

A level is only done when its truth table has no `MISMATCH` row. The harness plays every solution the level
declares (`solutions.reference` and each `solutions.wrong` entry) through the real engine, the way a learner
would, and compares the engine's verdict with what the level says it should be.

```
scripts/grade/grade.sh [--engine URL] [--workspace DIR] [--levels DIR] [--run-ops] [--json FILE] <chapter-dir | level-id>...
```

Examples:

```
scripts/grade/grade.sh levels/ch1-keyspace                       # a whole chapter
scripts/grade/grade.sh ch1-07-hostel-scoreboard                  # one level, found by id under levels/ (and _examples/)
scripts/grade/grade.sh levels/ch0-boot ch1-16-first-code-register-a-user --json /tmp/table.json
```

## What you need running

The tool only talks HTTP, so any engine will do, but it must have **the same level files mounted** as the ones
you point the tool at, and `ENGINE_DEV=1` (the tool unlocks levels through `POST /api/levels/:id/complete`).
The default engine URL is `http://127.0.0.1:3500` (`--engine` or `GRADE_ENGINE` changes it).

- Full proof (what `scripts/check/G-01.sh` does): a private compose project `quest-g01` with scratch workspace,
  progress and a copy of the levels. Run `scripts/check/G-01.sh`. It takes a few minutes because traffic levels
  record a baseline and run load.
- Quick loop while writing a level: start your normal stack (`scripts/start`, with `ENGINE_DEV=1` in `.env`),
  restart the engine after editing level YAML (no hot reload), then run the tool against your level id. Use
  `--engine http://127.0.0.1:3000`. The grader creates (or reuses) a player and completes the levels before the one
  it grades, so run it against a scratch progress directory, not your own save.

## What it does for each solution

State is reset between solutions by calling `POST /api/levels/:id/start` again, which re-runs the level's `setup`
(and the engine runs `fixtures` itself).

| solution | how it is played |
|---|---|
| `.redis` (cli, or an ops level that names a `.redis`) | each line (comments and blanks skipped, `{{player.id}}` etc. rendered with `renderTemplate`) goes through `POST /api/cli` |
| `.js` (code) | copied into the slot's workspace file (`PUT /api/workspace/file`, or into `--workspace DIR`), and the engine activates the slot while it verifies. Slot-to-file comes from `GET /app/slots`, with a built-in table as fallback |
| `.sh` (ops shell) | **not run**: the row is `SKIPPED (ops shell)`. `--run-ops` runs it on this Mac from the repo root with the environment the tool was given; without `COMPOSE_PROJECT_NAME` those scripts run `docker compose` against the default project, so export the grading stack's environment (see "Ops solutions") or only use it on a machine you can afford to disturb |
| decision (`option:`) | the reference answers every quiz correctly; a wrong entry swaps in that one option |

Then it fills the other verifiers:

- `answer`: for a solution declared `right` or `works_but_wrong`, the tool runs `expected.cmd` through `/api/cli` after
  the solution and types back that reply. For a `wrong` solution it types `not-the-answer`.
- `quiz`: correct option(s) for `right` and `works_but_wrong`, a wrong option for `wrong`.
- `interview.questions` (E-05, a `rebuild_of` interview level): the level's follow-up questions sit after its own
  verifiers (indices continue), answered like a pool entry's: all right for `right` and `works_but_wrong`, the first one
  wrong for `wrong`. The row's note says `N follow-up questions`.
- `event`: `cli_ping` comes from a `PING` in the solution; `ui_connected` is posted as the UI would; `progress_restored` is
  produced by the harness calling `POST /api/progress/restore` (what accepting the restore offer does), and **only the
  restore**, so an engine that never emits the event is a mismatch, not hidden.
- After any solution file that contains `CONFIG SET` (ops levels such as ch2-09) the tool re-applies the stack's defaults through `/api/cli` (`maxmemory 536870912`, `maxmemory-policy noeviction`, `save "60 1000"`, `appendonly yes`, `appendfsync everysec`, `latency-monitor-threshold 0`) and prints one line, so a wrong solution that set `noeviction` at 64mb cannot poison later levels with OOM errors.
- A solution that ran `FLUSHALL`/`FLUSHDB` is followed by a restore, so the game's own mirror is back for the next one.

Traffic levels print progress (`load baseline`, `load run`, `still verifying`) from the engine's WebSocket events.

## Bundle solutions (levels with several slots)

A level whose verify specs name more than one slot (ch2-07, 08, 12, 13) still has one `reference` path per solution, so
each solution is a **bundle module**: one file with a named export per slot and a default export. The convention: the
named export for a slot is the part of the slot name after the first dot (`prefetch.bulkLoad` -> `bulkLoad`,
`session.destroyAll` -> `destroyAll`). The harness copies the bundle to
`<workspace>/<dir of the first slot's file>/_bundle-<level-id>-<solution-basename>.js` and writes each slot's own workspace
file as a two-line shim:

```js
import * as bundle from './_bundle-ch2-07-fixtures-must-never-miss-07-reference.js';
export default bundle.bulkLoad;
```

The relative import resolves in both the app and the runner. Activation and verification then go exactly as for a
single-slot level. After each solution the shims and the bundle are restored (deleted with `--workspace`, emptied through
the API, which cannot delete; an empty file has no default export). A bundle that lacks an export a slot needs leaves that
slot's default `undefined`, which the engine reports as the slot failing, so name exports exactly.

## Events the harness produces

A level can wait for something that happens while it verifies. The harness produces that event for a solution
declared `right` or `works_but_wrong`, and produces nothing for one declared `wrong` (the same rule `answer` and
`quiz` follow). Levels without these event kinds are graded exactly as before. Six rules (E-01, C4, E-02):

- **`key_expired`** (`match.key`). The engine subscribes to expired-key events only while the check waits, so
  when `verify_check_started` arrives for that verifier the harness runs `SET <key> harness-probe PX 800` through
  `/api/cli`, then `EXISTS <key>` once a second: Redis deletes an expired key when its sampling finds it or when it
  is read, and reading it makes the event fire at once. The level's own reference may set the key too; that is for the
  learner, not for the harness. Also: after a `.redis` solution that ran `FT.CREATE` the harness waits 1.5 s before
  verifying, because the index fills from existing documents in the background.
- **`service_scaled`** (`match.instances: N`, N is 2 in Chapter 3). Before calling verify the harness POSTs
  `/internal/metrics` once a second for 3 s as a second instance, id `grader-instance-2` (`routes: {}`,
  `windowMs: 1000`, `at` on a second boundary). The engine's own emitter then fires: the harness never posts the
  event itself. It reads `GET /api/events` afterwards and prints whether the engine emitted it. Run the stack with
  exactly N-1 real app instances (the default `app=1` for N = 2): with two real instances running the fake one makes
  three and no `instances: 2` event happens. Because the fake instance stays live for 5 s after its last push, a
  second good solution of the same level waits until it has expired (about 8 s) before pushing again.
- **`channel_message`** (`match.channel`). The engine only sees a message while its check is waiting (it SUBSCRIBEs
  during the check), so the harness starts verify without awaiting it, watches the `verify_check_started` WebSocket
  event for that verifier's index, and then runs `PUBLISH <channel> <message>` through `/api/cli`, first after 300 ms
  and then once a second until `verify_check_finished` for that index (at most 10 times). The message is
  `{"matchId":"m-041","seq":1,"over":1,"ball":1,"runs":4,"batter":"p-028"}` unless the verifier has `match.message`,
  which wins. The harness needs the engine's WebSocket; without it the check just times out.
- **custom `ticker_gap`** (the app's ticker worker posts it when a subscriber sees a gap in `seq`). Before verify the
  harness PUBLISHes `score:match:m-041` seq 1, POSTs `/app/ticker/resubscribe` `{ matchId: m-041, pauseMs: 1000 }`
  (not awaited), sleeps 200 ms, PUBLISHes seq 2 and 3, awaits the resubscribe answer, then PUBLISHes seq 4. If the
  route answers 404 it prints `NOTE ticker_gap: /app/ticker/resubscribe not available (A-02 not merged)` and carries
  on; the level then shows as a mismatch, which is correct.

- **custom `load_finished`** (`match.scenario`, E-02). The learner "ran the traffic". Before verify the harness POSTs
  `/api/load/start { scenario, durationSec: 5 }` (a 409 means a verification or another run is going: it waits 2 s
  and retries, up to 15 times) and polls `GET /api/load/status` every 500 ms until `running` is false (cap 40 s). The
  engine's own `load_finished` is what the level then sees; the harness never posts it. The run goes against the
  solution's code: the harness puts the level's slots on first (`PUT /api/slots`, 2.5 s for the app to pick it up) and
  puts the previous list back after, as a learner's own "run traffic again after the fix" would; with the slots off the
  traffic would exercise the planted fault and the level's checks would then see that damage (ch4b-06's leaked
  connections). The note carries the slots and the run's requests, req/s, p99 and errors.
- **custom `script_killed` and `redis_busy`** (E-02; one dance covers both, and a level with both gets it once). The
  harness POSTs A-04's `/app/oncall/badges/recompute` (a Lua loop that holds Redis) without awaiting it, waits 5.5 s
  (past `busy-reply-threshold`, 5 s by default), runs `PING` through `/api/cli` (Redis answers `BUSY`, so the engine emits
  `redis_busy`), then `SCRIPT KILL` through `/api/cli` (`OK`, so the engine emits `script_killed`), then waits up to
  15 s for the blocked request to end. If the route answers 404 within the first second it prints
  `NOTE script_killed: /app/oncall/badges/recompute not available (A-04 not merged)` and carries on; the level then
  shows as a mismatch, which is correct.

Each rule adds one line to the row's `note`.

Levels the harness does **not** play without `--run-ops` (E-03, E-05). A level with an `event` verifier that names the custom event
`redis_target_changed` or `sentinel_failover` needs the compose profiles (`replica`, `sentinel`, `cluster`) running and
a hand on the Docker side (switch the target on the page, `docker compose stop redis`), and nothing the harness does
through the engine produces them. Every solution of such a level is recorded as `SKIPPED (needs the compose profiles:
graded by hand)` and the level is completed so later levels unlock, exactly like the outage levels (`redis_disconnect` /
`redis_reconnect`: `SKIPPED (needs a real Redis outage: graded by hand)`). Grade them by hand once per release, with the
profiles up, or with `--run-ops` (below) when the level has `.sh` solutions.

## Ops solutions (E-05, `--run-ops`)

`--run-ops` runs the `.sh` solutions and lifts two skips: "ops shell", and "needs the compose profiles" for a level
that has at least one `.sh` solution (a profile level whose solutions are only `.js` or `.redis`, ch5-09, stays skipped:
nothing would start its cluster). "Needs a real Redis outage" stays, unless a `.sh` solution of the level itself runs
`docker compose stop redis` or `kill redis` (none does today; ch5-01 kills its own `redis-nopersist` node and stays skipped).

**Environment.** A script runs from the repo root with the tool's own environment, plus: `QUEST_API` (default: the
`--engine` URL, so `curl "$API/api/target"` reaches the grading stack), `PROXY_PORT` (default: the port of `--engine`,
which `scripts/hit.sh` and `scripts/ticker-drill.sh` read), `QUEST_OPS_ROOT` (when `--workspace` or `G01_WORKSPACE` is
known: a folder whose `workspace` links to the stack's workspace, for scripts that `cd workspace`, the finale's) and a
git identity if none is exported. `docker compose` inside the script acts on the grading stack when the caller exports
`COMPOSE_PROJECT_NAME`, `COMPOSE_FILE` (files separated by `:`) and `COMPOSE_ENV_FILES`: Docker Compose gives the
environment precedence over the file's `name:`. `G01_RUN_OPS=1 scripts/check/G-01.sh` exports exactly that for project
`quest-g01` (and `scripts/grade/compose.g01.yaml` takes the profile services' host ports away, so the profiles can run
next to a learner's default stack). **Without `COMPOSE_PROJECT_NAME` the row is run against the default project** and the
log line says so.

**Sequence around one `.sh` solution:**
1. `POST /api/levels/:id/start` (setup re-runs), then the script, in its own process group. Time limit 300 s
   (`QUEST_OPS_TIMEOUT_S`). A script that runs an attached `docker compose up` (no `-d`; ch0-01's wrong one) gets 20 s and
   then Ctrl-C, as a learner would give it.
2. The engine's `/health` must say redis and postgres are up. A script may `down` and `up` the stack, or leave it down
   (`./scripts/start` refuses to run next to another project's ports: its preflight sees the grading ports held by a
   project it does not know). If it is not answering and `COMPOSE_PROJECT_NAME` is set, the harness runs
   `docker compose up -d --no-build redis postgres engine app runner proxy`. It then waits up to 90 s
   (`QUEST_OPS_HEALTH_S`) and puts what happened in the row's note. Then `/app/health` (60 s).
3. Answers and `verify` as for any solution. **The harness fakes nothing the script did for real:** for a `.sh` solution
   the `service_scaled` fake-instance pushes are not made (the script's `docker compose up --scale app=2` is the second
   instance); the other events (a channel message, an expiring key, ...) are produced as for any solution.
4. After verify, on an isolated project: `docker compose up -d --no-build --scale app=1 app` and wait for `/app/health`
   (the note says `app had N instance(s) after the script; scaled back to 1` when N was not 1); if `GET /api/target` is
   not `redis://redis:6379` it is put back with `PUT /api/target`; if the stack had been down, `POST /api/progress/restore`.

The harness does **not** stop profile services a script started: the reference scripts end with the way back (or, in
ch5, leave the replica and Sentinels for the next level on purpose). A reference that leaves something behind that breaks
a later level is a content bug: list it in `scripts/grade/known-content-bugs.tsv`.
Expect extra time: the ch5 failovers alone take a few minutes, `./scripts/start` rebuilds the image.

After verify the harness also resets the topology on an isolated project: it stops any profile service the script left running (the no-persistence node, the replica, the sentinels, the cluster nodes) and, if `redis` reports `role:slave`, runs `REPLICAOF NO ONE` and waits for `role:master`. A Sentinel that remembers another master would otherwise demote the returning `redis` minutes later and every later write would answer `READONLY`.

## Pool levels and the portfolio event (E-04)

**A pool level** (`interview.pool`, see `levels/README.md`) has no `verify` and no `solutions` of its own. The harness
plays it like this, once per solution of the level that was drawn:

1. `ensureUnlocked`, then `POST /api/levels/:id/start`: the first start draws (and blanks the drawn level's slot
   files; the harness's own restore puts them back to what they were then, an empty file).
2. `GET /api/levels/:id`, take `interview.drawn.id`, find that level (among the chapters asked for, then everything
   under `--levels`) and grade with **that** level's `solutions`: the reference declared `right`, each wrong entry as
   declared. File paths resolve from the **drawn level's** directory, the slots, bundle shims and events are the drawn
   level's, exactly as if the harness were grading it. The pool level is `start`ed again before every solution (the
   draw is kept; `setup` of the drawn level re-runs).
3. Answers: the drawn level's `answer` and `quiz` verifiers as usual, then the pool entry's follow-up questions at the
   indices that continue after them. A solution declared `right` or `works_but_wrong` gets every question right; one
   declared `wrong` gets the first question wrong (and the drawn level's own checks are what fail it anyway).
4. `POST /api/levels/:id/verify` on the **pool** level. The row's `LEVEL` is the pool level, `DECLARED` the drawn
   level's declaration, and the `note` says what was drawn (`drew <id> (<title>), N follow-up questions`).

A drawn level that needs a real outage or the compose profiles is `SKIPPED` like any other. A pool level is completed
afterwards (`/complete`) so the next one unlocks and, because the draw excludes use cases already drawn by other pool
levels, a chapter with several pool levels shows a different drawn level per row.

**`portfolio_written`** (custom event). A level that waits for the
learner's story is graded like the others, and for a solution declared `right` or `works_but_wrong` the harness posts
`POST /api/portfolio/write` after the solution ran and before it verifies (what pressing "Write my story" does); the
engine's own `portfolio_written` is what the level then sees, the harness never posts the event itself. A solution
declared `wrong` does not write the story, so the event never comes and the level is wrong.

## Reading the table

```
LEVEL       SOLUTION                      DECLARED          ENGINE            RESULT
ch1-07      07-reference.redis            right             right             PASS
ch1-07      07-works-but-wrong-list...    works_but_wrong   right             MISMATCH
```

`RESULT` is `PASS` (engine verdict equals the declaration), `MISMATCH`, or `SKIPPED`. After the table every mismatch is
repeated with the engine's per-check feedback (`[ok]`, `[fail]`, `[HIT]` for an antipattern that fired, `[skip]`) and
the `because:` you wrote. Exit codes: 0 no mismatch, 1 at least one mismatch, 2 the tool could not run (engine
down, level not known to the engine, files invalid). `--json FILE` writes the same rows plus the feedback.

## Fixing a mismatch

| you see | usually means |
|---|---|
| reference declared `right`, engine `wrong` | a check or `expected` is wrong, setup does not create what the task says, or the reference does not do the task. Read the `[fail]` lines: they are the feedback a learner would get |
| wrong solution declared `wrong`, engine `right` | no verifier catches it. Add a check that fails for it |
| `works_but_wrong` declared, engine `right` | the antipattern check did not fire. Remember antipattern checks describe the **healthy** state, and a failing one is a hit |
| `works_but_wrong` declared, engine `wrong` | an ordinary verifier already fails it, so the antipattern can never be the only failure; either make the solution correct apart from the smell or declare it `wrong` |
| engine `HTTP 4xx/5xx` | the engine refused the call; the body is in the feedback |
| `SKIPPED (no slot ...)` | a code level whose verifiers name no slot (or a slot the app does not know); there is nowhere to put the solution |

Do not edit a level just to make the harness green if the level is right and the engine or UI is not; report it.

## Limits

- Ops shell solutions are never executed by default, so `ch0-01`, `ch0-04`, `ch0-05` and `example-ops` are only
  `SKIPPED` unless you use `--run-ops`. Under it, `ch0-04` runs `open http://localhost:5540` on your Mac (a browser tab,
  nothing the grading stack sees), and a level whose check is already true in a running stack (ch0-01's
  "the engine has booted") cannot fail for a script that did nothing useful.
- The tool feeds correct answers to `works_but_wrong` and wrong answers to `wrong` solutions. A wrong solution that
  passes every `redis` check and relies on a missing answer is graded as the learner would see it (the wrong answer fails it).
- It does not test hints, brainstorm, story text, XP, or the UI (a pool level's clock and hint cost are covered by the engine's own tests).
