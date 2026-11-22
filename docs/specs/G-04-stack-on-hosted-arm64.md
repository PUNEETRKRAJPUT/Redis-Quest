# G-04: the stack, proven on hosted arm64 runners

Written after the fact, on 2026-11-22: the work began as an emergency check of a merge and became a task.

## Why
`ci.yml` proves the code: build, lint, unit tests, level validation. The thing a learner actually starts (the
image, the compose stack, the start page, every check that needs Docker) was proven only on a developer's Mac,
by hand, with `scripts/check/ci-local.sh`. On 2026-11-22 ten days of work were merged into `main` without
having run once, while local runs were on hold. There was no way to run the merged tree anywhere but a Mac.

GitHub offers Linux arm64 runners to public repositories (`ubuntu-24.04-arm`: 4 CPUs, 16 GB): the same
architecture and the same images as the game's home. Its Mac runners cannot run Docker (no nested
virtualisation on Apple Silicon runners), which is why `ci.yml`'s `mac` job has always skipped itself.

## What to build
1. `.github/workflows/stack.yml`, on `ubuntu-24.04-arm`, for pushes to `main` and to `e2e/**`:
   - **`stack`**: a fresh clone started in the order `scripts/start` uses (the proxy first), the start page
     probed while nothing else is up, the image built, everything started, the stack probed from outside, then
     `scripts/check/D-04.sh` with a live request.
   - **`days`**: the days' own checks that need Docker or were never marked docker-free: D-02 (without its
     whole-start part), D-03, D-05, D-06, D-07, D-08, D-09.
   - **`suite`**: every `scripts/check/P*.sh` and `C*.sh`, P0-10's browser test included. Each is reported and
     none stops the others (`all.sh` stops at the first failure).
2. `scripts/ci/stack-probe.mjs`: the outside probe, modes `start-page` and `up`. Plain Node, no dependencies.
3. `scripts/ci/run-check.sh`, `scripts/ci/linux-shims.sh`, `scripts/ci/runner-setup.sh`: what lets check scripts
   written for a Mac run on Linux without being edited.
4. `scripts/check/G-04.sh` (docker-free, so `ci.yml` runs it): the workflow's shape and the helpers.

## Rules
- The check scripts and `scripts/start` are not edited for the runner (`D-02.sh` insists that `scripts/start`
  keeps its BSD spellings). Each difference is stood in from outside, and each stand-in says what it stands for.
- A job the runner cannot judge does not run there. Anything that judges a time on the machine stays a check
  for a Mac, and the workflow says so in the place where it would be: the full grader (G-01) and chapter 5
  level 03's disk proof.
- A read-only token, no secrets, no `pull_request_target`.
- The probe's `up` mode creates a player and reads `/api/league`, which makes the engine empty Redis database
  7. It is for a fresh, throwaway stack. Never point it at a save.

## Files
`.github/workflows/stack.yml`, `.github/workflows/README.md`, `scripts/ci/stack-probe.mjs`,
`scripts/ci/run-check.sh`, `scripts/ci/linux-shims.sh`, `scripts/ci/runner-setup.sh`, `scripts/check/G-04.sh`,
`scripts/check/ci-local.sh` (one comment), `docs/handoffs/G-04.md`.

## Done means
The three jobs are green on the commit that reaches `main`; `scripts/check/G-04.sh` passes on a Mac and in
`ci.yml`; `.github/workflows/README.md` describes the workflow; the handoff says what the runner cannot prove.
