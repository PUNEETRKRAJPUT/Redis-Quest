# CI

`ci.yml` has two jobs.

- `fast` (ubuntu-latest, Node from `.node-version`, pnpm from `packageManager` via corepack): frozen-lockfile
  install, `pnpm -r build|lint|test`, `levels:validate` on every `levels/<chapter>` not prefixed `_`,
  `levels/_examples` expected to fail with positioned errors, and every `scripts/check/*.sh` that contains the
  exact line `# ci: docker-free`. This is the green run that gates `main`.
- `mac` (macos-latest): runs only if `docker info` succeeds. GitHub's macOS runners ship no Docker, so it
  skips itself with a visible notice.

Why not more in this file: `ubuntu-latest` is amd64 and this project pins `linux/arm64` images (Apple Silicon
only). We do not emulate arm64 with QEMU; it is slow and proves the wrong platform. The Docker-backed checks
run on arm64 runners in `stack.yml`, below. (`scripts/check/P0-12.sh` wants this file's two jobs kept as they
are.)

## `stack.yml`: the real stack on hosted arm64 runners (G-04)

Three jobs on `ubuntu-24.04-arm` (free for public repositories: 4 CPUs, 16 GB), on every push to `main` and to
any branch named `e2e/<something>`:

- `stack`: a fresh clone started the way `scripts/start` starts it (the proxy first), the start page probed
  while nothing else is up, the image built, everything started, then `scripts/ci/stack-probe.mjs up` from
  outside, then `D-04.sh` with a live request.
- `days`: the ten days' own checks that need Docker (`D-02` without its whole-start part, `D-03`, `D-05` to
  `D-09`).
- `suite`: every `P*.sh` and `C*.sh`, P0-10's browser test of Chapter 0 among them. One run reports them all.

The check scripts are written for a Mac and are not edited for the runner. `scripts/ci/run-check.sh` runs each
one as root with `umask 000` (Linux enforces file owners on bind mounts, Docker Desktop does not) and with
three small stand-ins first on `PATH` (`scripts/ci/linux-shims.sh`: `uname -m`, `sw_vers`, `sed -i ''`).

What stays a Mac check, and why, is written in the workflow where each would be: `scripts/preflight.sh` and the
whole `scripts/start` (they ask for macOS), and anything that judges a time on the machine (the full grader,
`G-01.sh`, and chapter 5 level 03's disk proof). `pr-verdict.yml` grades every level whose verdict does not
depend on a time, on each pull request.

## Docker-backed checks on a Mac

`scripts/check/ci-local.sh` runs `scripts/check/all.sh` (plus the P0-10 Playwright hook once added) and appends
`<UTC timestamp> <sha> PASS|FAIL` to `docs/ci-local.log`, which is committed as the evidence. It takes many
minutes and starts Docker stacks.

`scripts/check/P0-12.sh` validates the workflow (actionlint if installed, else a YAML parse) and runs
`ci-local.sh` only when `P0_12_RUN_LOCAL=1`.


## Service containers on the `fast` job

The runner and shared-learner unit tests need a live Redis and Postgres, so the job starts `redis:8` and
`postgres:16` as GitHub service containers (amd64, which is fine for unit tests) and exports `REDIS_URL`
and `DATABASE_URL`. The schema is not loaded there; tests only use `SELECT` expressions. Anything that
needs the seeded database or arm64 images runs through `scripts/check/ci-local.sh`.
