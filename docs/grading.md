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
| `.sh` (ops shell) | **not run**: the row is `SKIPPED (ops shell)`. `--run-ops` runs it on this Mac from the repo root; those scripts run `docker compose` against the default project, so only use it on a machine you can afford to disturb |
| decision (`option:`) | the reference answers every quiz correctly; a wrong entry swaps in that one option |

Then it fills the other verifiers:

- `answer`: for a solution declared `right` or `works_but_wrong`, the tool runs `expected.cmd` through `/api/cli` after
  the solution and types back that reply. For a `wrong` solution it types `not-the-answer`.
- `quiz`: correct option(s) for `right` and `works_but_wrong`, a wrong option for `wrong`.
- `event`: `cli_ping` comes from a `PING` in the solution; `ui_connected` is posted as the UI would; `progress_restored` is
  produced by the harness calling `POST /api/progress/restore` (what accepting the restore offer does), and **only the
  restore**, so an engine that never emits the event is a mismatch, not hidden.
- A solution that ran `FLUSHALL`/`FLUSHDB` is followed by a restore, so the game's own mirror is back for the next one.

Traffic levels print progress (`load baseline`, `load run`, `still verifying`) from the engine's WebSocket events.

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
| `SKIPPED (no slot ...)` | a code level whose verifiers name no slot, or several; there is nowhere to put the solution |

Do not edit a level just to make the harness green if the level is right and the engine or UI is not; report it.

## Limits

- Ops shell solutions are never executed by default, so `ch0-01`, `ch0-04`, `ch0-05` and `example-ops` are only
  `SKIPPED` unless you use `--run-ops`.
- The tool feeds correct answers to `works_but_wrong` and wrong answers to `wrong` solutions. A wrong solution that
  passes every `redis` check and relies on a missing answer is graded as the learner would see it (the wrong answer fails it).
- It does not test hints, brainstorm, story text, XP, or the UI.
