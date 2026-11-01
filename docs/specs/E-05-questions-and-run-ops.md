# E-05: follow-up questions on every interview level; ops levels graded by the harness

**Goal.** Two gaps. First: only the Finale's pools ask interviewer questions after a rebuild; the nine chapter
interview levels should too, so `interview` gains `questions` on the `rebuild_of` form. Second: the grader
skips every `.sh` ops solution and every level that needs the compose profiles, so Chapters 0, 3 and 5 are only
proven by hand; with `--run-ops` the harness should run them against its own isolated stack.

**Depends on.** nothing (F-13 edits `ui/`; C-POL edits `README.md`, `docs/TESTING.md`, `docs/TESTER-MESSAGE.md`
and the nine interview levels' `questions:` blocks once your schema lands: write the schema first).

**Files owned.** `packages/shared/src/levels/` (schema, loader, tests), `engine/src/` except `verify/slots.ts`,
`engine/test/`, `scripts/grade/grade.mjs`, `scripts/grade/compose.g01.yaml`, `scripts/check/G-01.sh`,
`docs/grading.md`, `levels/README.md` (field tables only), the **first lines only** of the ops `.sh` solution
files under `levels/*/solutions/*.sh` (to honour an `API` / port variable: see work item 3), `scripts/check/E-05.sh`,
`.env.e05` (gitignored: `PROXY_PORT=3650 REDIS_PORT=6385 PG_PORT=5443 INSIGHT_PORT=5551 ENGINE_DEV=1`),
`docs/handoffs/E-05.md`.

**Must not touch.** `app/`, `runner/`, `ui/`, `packages/shared/src/learner/`, level YAML files (C-POL and F-13
own what they own there), `docker-compose.yml`, `docker/`, other checks, `docs/BUILD.md`.

**Interfaces to honour.** `docs/handoffs/E-04.md` (pool `questions`, how the engine appends them and how the
harness answers them), `docs/handoffs/F-12.md`, `docs/handoffs/G-01.md`, `docs/grading.md` (the skip rules: ops
shell, outage, profiles), `scripts/check/G-01.sh` (project `quest-g01`, `.env.g01`, the override, the scratch
dirs), `docs/handoffs/E-03.md` (profile port override in `scripts/check/compose.e03.yaml`; failover and failback
timings), Docker Compose's precedence: `COMPOSE_PROJECT_NAME` in the environment beats the file's `name:`,
`COMPOSE_FILE` lists files, `COMPOSE_ENV_FILES` names the env file.

**Work.**

1. **`interview.questions` on `rebuild_of` levels.** Schema: optional `questions: [quiz...]` (1 to 5) on the
   `rebuild_of` form, same shape as a pool entry's. Engine: `GET /api/levels/:id` appends them to the level's
   verifiers (indices after the level's own `verify`), verify grades them after the level's checks, exactly as
   pools do; `interview.questionsFrom` says where they came from. Harness: answers them correct for good solutions
   and one wrong for wrong ones (the pool code path, generalised). README field table. Tests.
2. **Run ops solutions against the harness's own stack.** With `--run-ops`, `grade.mjs` runs a `.sh` solution with
   the environment it is given plus `COMPOSE_PROJECT_NAME`, `COMPOSE_FILE`, `COMPOSE_ENV_FILES` and the `G01_*`
   variables when the caller exports them (G-01.sh will), so `docker compose ...` inside the script acts on the
   grading stack, never the default project. After every `.sh` solution the harness: waits for the engine's
   `/health` to answer again (an ops solution may `down` and `up` the stack; up to 90 s), puts the app back to one
   instance (`docker compose up -d --scale app=1 app` through the same environment, only when
   `COMPOSE_PROJECT_NAME` is set) and waits for `/app/health`, and if the solution changed the target (a level with
   `redis_target_changed`), puts it back to `redis://redis:6379` after verify. Under `--run-ops` the "needs the
   compose profiles" skip and the "ops shell" skip no longer apply; the "needs a real Redis outage" skip stays
   unless the level has a `.sh` that stops Redis itself (none today: keep it).
3. **The solutions must address the grading stack, not port 3000.** Read every `.sh` under `levels/*/solutions/`.
   Where one hard-codes `http://localhost:3000` (or `PROXY_PORT`), change only its first lines to
   `API=${QUEST_API:-http://localhost:3000}` (and use `$API` where the URL was; keep the rest of the file as it
   is) so the harness can export `QUEST_API=http://127.0.0.1:3500`. Where a script runs `scripts/hit.sh` or
   `scripts/ticker-drill.sh`, those already read `PROXY_PORT` from the environment: the harness exports it. List
   every file you touched and the one line changed in the handoff.
4. **`scripts/grade/compose.g01.yaml`** removes the published host ports of the profile services (as
   `compose.e03.yaml` does) so the grading stack can start profiles while a learner's default stack is up.
5. **`scripts/check/G-01.sh`** gains `G01_RUN_OPS=1`: exports `COMPOSE_PROJECT_NAME=quest-g01`,
   `COMPOSE_FILE=docker-compose.yml:scripts/grade/compose.g01.yaml`, `COMPOSE_ENV_FILES=.env.g01`, the `G01_*`
   paths, `QUEST_API` and `PROXY_PORT`, and passes `--run-ops`; prints at the top which mode it runs in; default
   off (the full local run stays as it is). Note the expected extra time (the ch5 failovers alone are a few
   minutes) in the handoff. Levels whose `.sh` starts profiles must find them stopped afterwards: the harness, after
   an ops level in run-ops mode, stops profile services it started? No: simpler and honest, the level's own
   reference `.sh` ends with the way back (C5 wrote them so); the harness only enforces the app scale, the target
   and the engine's health. If a reference does not clean up and a later level breaks, record it as a content
   bug in `scripts/grade/known-content-bugs.tsv` and in the handoff rather than papering over it.

**Acceptance check.** `scripts/check/E-05.sh` (bash 3.2, project `quest-e05`, `.env.e05`, the g01-style override
with ports removed, scratch levels: `example-code`, `example-interview` with two `questions` added in a scratch
copy, `example-ops`, and a scratch ops level whose `.sh` reference runs `docker compose up -d --scale app=2 app`
then back to 1 and whose verify is `event service_scaled instances 2`; scratch progress and workspace; `down -v`
on exit):
- shared, engine vitest; lints; format; `levels:validate levels` clean (8 chapters, 96 levels) after your `.sh`
  first-line edits;
- the interview copy with `questions` shows them in `GET /api/levels/:id` after the level's own verifiers, grades
  right with correct answers and wrong with a wrong one, and the harness feeds them (right/wrong rows PASS);
- `--run-ops` with the exported compose environment: `example-ops` reference and wrong graded (the wrong one
  `down -v`s the stack: the harness waits for the engine to come back, and the row says what happened), the
  scratch scale level graded right by its `.sh` (a real second instance, no fake pushes: the harness must not
  fake when the level has a `.sh` solution under run-ops; say the rule), the app back to one instance after;
- a dry run of `scripts/check/G-01.sh` is not required (it takes long), but `bash -n` and a grep for the new
  mode's exports;
- exit 0, print each thing verified.

**Handoff.** `docs/handoffs/E-05.md`: the `questions` contract, the run-ops environment and sequence, the files
whose first lines changed, what the harness enforces after an ops solution, and the check output.

**Model.** sonnet
