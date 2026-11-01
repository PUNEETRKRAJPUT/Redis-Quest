# G-01: Level grading harness

**Goal.** One command that plays every declared solution of a chapter (or one level) through the real
engine and prints a truth table: level, solution, declared verdict, engine verdict, PASS/MISMATCH, with the
engine's feedback on mismatches. Content is only "done" when this table has no mismatches. The verifier's
own check (`scripts/check/P0-09.sh`) already contains this logic for the example levels; extract and
generalise it.

**Files owned.** `scripts/grade/` (the tool: a Node ESM script plus a thin bash wrapper
`scripts/grade/grade.sh`), `scripts/check/G-01.sh`, `docs/grading.md`.

**Must not touch.** engine, app, runner, ui, packages, levels content (read only), other checks.

**Interfaces.** Engine HTTP API per `docs/handoffs/P0-06.md` and `docs/handoffs/P0-09.md`
(`POST /api/player`, `/start`, `/brainstorm`, `/hint`, `/verify` with `answers`, `PUT /api/slots`,
`PUT /api/target`, `POST /api/cli`, `GET /api/levels/:id/ideal`, baselines). Level files per
`@quest/shared` loader (use it to read solutions and verify specs rather than parsing YAML ad hoc).

**Behaviour.**
- `scripts/grade/grade.sh [--engine http://127.0.0.1:3500] [--workspace <dir>] <chapter-dir|level-id>...`
- For each level: create or reuse a player; `start`; brainstorm with any reasonable option; then for each
  solution: `cli`/`ops` `.redis` files are sent line by line through `/api/cli` with templating applied
  (`{{player.id}}` etc.; the loader's `renderTemplate`); `.sh` solutions are NOT executed (print `SKIPPED
  (ops shell)`) unless `--run-ops` is given; `code` solutions are copied into the slot's workspace file
  (slot → file mapping from `docs/handoffs/P0-07.md`, read from the app's registry if exposed, else a
  table in the tool) and the slot is activated through the engine; `answer` verifiers get the expected
  value computed by running `expected.cmd` through `/api/cli` for the reference and a wrong string for
  wrong solutions; `quiz` gets the reference options for the reference and each wrong option for wrong
  ones; then `/verify`, record the verdict, and reset state between solutions by re-running the level's
  `setup` through `/start` (and `fixtures` are the engine's job).
- Prints the table and exits 1 on any mismatch. `--json <file>` writes it too.
- Traffic levels take minutes; print progress lines as the engine's WebSocket events arrive (or poll).

**Isolation.** Project `quest-g01` with `.env.g01` (3500/6395/5437/5545), full stack minus insight;
`docker compose -p quest-g01 down -v` at the end of the check. The tool itself targets any engine URL.

**Check.** `scripts/check/G-01.sh`: start the project, run the harness over `levels/_examples`
(expect the known mismatch for `example-code-01` works-but-wrong to be GONE now that the example was
fixed, and `example-ops` to be `SKIPPED (ops shell)`), over `levels/ch0-boot` (ops levels skipped, cli
levels graded), over `levels/ch1-keyspace` and over `levels/ch2-everyone-showed-up` (traffic included).
Print the three tables. Exit 0 only if every graded solution matches its declaration; list every
mismatch at the end. If a mismatch is clearly a content bug, do not edit the level: report it.

**Handoff.** `docs/handoffs/G-01.md` with the full tables and a list of content bugs found.

**Model.** sonnet
