# CI

`ci.yml` has two jobs.

- `fast` (ubuntu-latest, Node from `.node-version`, pnpm from `packageManager` via corepack): frozen-lockfile
  install, `pnpm -r build|lint|test`, `levels:validate` on every `levels/<chapter>` not prefixed `_`,
  `levels/_examples` expected to fail with positioned errors, and every `scripts/check/*.sh` that contains the
  exact line `# ci: docker-free`. This is the green run that gates `main`.
- `mac` (macos-latest): runs only if `docker info` succeeds. GitHub's macOS runners ship no Docker, so it
  skips itself with a visible notice.

Why not more: hosted Linux runners are amd64 and this project pins `linux/arm64` images (Apple Silicon only).
We do not emulate arm64 with QEMU; it is slow and proves the wrong platform.

## Docker-backed checks run on a Mac

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
