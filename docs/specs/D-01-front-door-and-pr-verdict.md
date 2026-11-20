# D-01: the front door, and a machine verdict on every pull request

Rules for every day task: `docs/specs/_days-common.md` (code only, no local runs, commit and push often).
Branch: `day-01-front-door`.

## Goal
A stranger can find out how to contribute, and their pull request is judged by a machine instead of by the owner.

## Build
1. **Contributor files** (plain words, short, original text, no copied policy documents): `CONTRIBUTING.md`
   (how the repo works: spec, check, handoff, one commit per task; ways in by size; how levels are graded;
   Apple Silicon only; the isolation rule from `docs/handoffs/G-03.md`), `CODE_OF_CONDUCT.md`, `SECURITY.md`
   (the game is local and has no secrets; how to report a problem), `.github/PULL_REQUEST_TEMPLATE.md`,
   `.github/ISSUE_TEMPLATE/bug.md` and `level-idea.md` (keep `playtest-finding.md`).
2. **`scripts/ci/stack.mjs`** (Node, no dependencies): starts the built engine, app and runner as plain
   processes against a Redis and a Postgres given by `REDIS_URL` and `DATABASE_URL`, puts one origin in front of
   them the way `docker/Caddyfile` does (`/app/*` to the app; `/api/*`, `/health`, `/ws`, `/internal/*` to the
   engine, WebSocket upgrade included), waits until `/health` answers, prints the origin, and stops everything on
   SIGTERM. Read `engine/src/config.ts`, `app/src/config.ts`, the runner's config and `docker-compose.yml` for the
   environment each one needs.
3. **`scripts/grade/grade.mjs --deterministic`**: grade only what cannot depend on the machine's speed. Read
   the harness first. Keep levels whose mode is `cli`, `code` or `decision`; skip, with a printed reason, every
   level that needs a Compose profile, a live outage, or a traffic assertion about latency or a measured
   baseline. A skip is never a failure; a MISMATCH is.
4. **`.github/workflows/pr-verdict.yml`**: on `pull_request`, with `redis:8` and `postgres:16` service containers
   and the seed loaded exactly as the `fast` job in `ci.yml` does it: install, build, start `scripts/ci/stack.mjs`,
   run the grader in deterministic mode, and write its table to the job summary. Read-only token; no secrets.
5. **`scripts/review-pr <number>`** for the maintainer's Mac: fetch the pull request into a temporary worktree,
   run `scripts/check/G-03.sh` there, then `G01_RUN_OPS=1 scripts/check/G-01.sh` (it isolates itself), print
   the evidence, and with `--comment` post it using `gh pr comment`. It refuses to run a pull request that
   changes `scripts/` or `.github/` unless called with `--i-read-the-diff`: those files run on the Mac.
6. **README**: the "Contributing" section points at `CONTRIBUTING.md`. Touch no other README section.
7. In the handoff, a **maintainer checklist** with the exact `gh repo edit` commands for the description, topics
   and Discussions (the owner runs them; this Mac's `gh` login cannot).

## Files you own
The files named above, `scripts/ci/**`, `scripts/check/D-01.sh`, `docs/handoffs/D-01.md`.

## How it will be verified later
The workflow's first real run is its own pull request. `scripts/review-pr` and `stack.mjs` need a Mac with
Docker: say exactly how to try them.
