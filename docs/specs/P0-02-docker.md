# P0-02: Docker: node image, compose, Caddyfile, start and preflight scripts

**Goal.** One command brings up the whole local stack on an Apple Silicon Mac, and a preflight script
tells a beginner exactly what is missing before anything is pulled. Engine, app and runner images build
even though their servers do not exist yet (those are wave 3).

**Depends on.** P0-01 (the workspace must build inside the image)

**Files owned.**
- `docker/node.Dockerfile`, `docker/Caddyfile`, `docker/README.md`
- `docker-compose.yml`, `.env.example`
- `scripts/start`, `scripts/stop`, `scripts/reset`, `scripts/preflight.sh`
- `scripts/check/P0-02.sh`

**Must not touch.** `engine/`, `app/`, `runner/`, `ui/`, `packages/`, `postgres/`, `fiction/`, `docs/`
(except nothing), root `package.json`.

**Interfaces to honour** (other tasks are written against these; do not rename).
- Services, hostnames, images, host ports exactly as `docs/PLAN.md` section 2 "Draft docker-compose.yml"
  and the "Ports used" paragraph. All images `platform: linux/arm64`. Every service has `mem_limit`.
- Host ports come from `.env` with defaults: `PROXY_PORT=3000`, `INSIGHT_PORT=5540`, `REDIS_PORT=6379`,
  `PG_PORT=5432`. Compose uses `127.0.0.1:${REDIS_PORT:-6379}:6379` and so on. Container-side ports
  never change.
- Internal ports: engine `4200`, app `4000`, runner `4100`. Caddy on `:3000` routes `/app/*` to
  `app:4000` (path preserved, not stripped) and everything else, including WebSocket upgrades, to
  `engine:4200`. Caddy access log to `/logs/proxy/access.log` (JSON).
- Env for node services: `REDIS_URL=redis://redis:6379`, `DATABASE_URL=postgres://quest:quest@postgres:5432/quest`,
  `LOG_DIR=/logs`, `PROGRESS_DIR=/progress`, `WORKSPACE_DIR=/workspace`, `APP_URL=http://proxy:3000/app`,
  `RUNNER_URL=http://runner:4100`, `ENGINE_URL=http://engine:4200`, `PORT` per service.
- Volumes: `./workspace:/workspace`, `./logs:/logs`, `./.progress:/progress` on engine, app, runner.
  Named volumes `redis-data`, `pg-data`, `insight-data`.
- Redis command: `redis-server --maxmemory 512mb --save "" --appendonly no` (Chapter 5 turns persistence
  on). Healthcheck `redis-cli PING`.
- Postgres: image `postgres:16`, user/password/db `quest`, `shared_buffers=256MB`, `logging_collector=on`,
  `log_directory=/logs/postgres`, `log_min_duration_statement=100`, init dir `./postgres/init` mounted
  read-only at `/docker-entrypoint-initdb.d` (P0-04 fills it; mount it even if empty now).
- Insight: `redis/redisinsight:latest`, `127.0.0.1:${INSIGHT_PORT}:5540`, volume `insight-data:/data`.
- Profiles `crash`, `replica`, `sentinel`, `cluster` exist in the compose file with the services named
  in the plan (`redis-nopersist`, `redis-replica` on host 6380, `sentinel-1..3` on 26379..26381,
  `redis-c1..c6` on 7100..7105 with `--cluster-enabled yes --cluster-announce-hostname <service>
  --cluster-preferred-endpoint-type hostname`). They only need to start; Chapter 5 tasks make them
  correct. Sentinel config files live under `docker/sentinel/`.
- Proxy must **not** `depends_on` engine or app (they do not exist yet); it returns 502 until they do.

**Work.**
1. `docker/node.Dockerfile`: multi-stage on `node:22-bookworm-slim`. Stage `build`: `corepack enable`,
   copy workspace, `pnpm install --frozen-lockfile`, `pnpm -r build`. Stage `runtime`: production deps
   only, `dist/` of each package, non-root user, `WORKDIR /srv`. One image; services differ by `command`.
2. `docker-compose.yml` and `.env.example` as above. `name: redis-quest`.
3. `scripts/preflight.sh` (bash 3.2 compatible, no dependencies beyond macOS + Docker CLI). Checks,
   each printed as PASS/FAIL with a one-line fix: `uname -m` is `arm64`; macOS 14 or newer; `docker`
   CLI present; daemon reachable (if not, offer to run `open -a Docker` and wait up to 90 s); Compose
   v2 ≥ 2.20; Docker memory `docker info --format '{{.MemTotal}}'` ≥ 6 GiB with the exact Settings →
   Resources path in the message; ≥ 10 GB free disk; `git` present; each host port from `.env`
   (or defaults) free, and when one is taken print the owning process (`lsof -nP -iTCP:<port>
   -sTCP:LISTEN`) and the fix (for 6379: `brew services stop redis` or set `REDIS_PORT=6390` in `.env`).
   Exit 1 if any FAIL. `--quiet` prints only failures.
4. `scripts/start`: run preflight; create `.env` from `.env.example` if missing; `mkdir -p logs
   .progress`; `docker compose up -d --build`; wait for redis and postgres health; try
   `http://localhost:${PROXY_PORT}/health` for 60 s and print the URLs; if the engine is not up yet say
   so plainly instead of failing (wave 3 adds it). `scripts/stop` = `docker compose down`.
   `scripts/reset` = `docker compose down -v` after a y/N prompt, keeping `.progress/`.
5. `scripts/check/P0-02.sh`: `docker compose config -q`; `docker compose build`; every built or pulled
   image reports `Architecture: arm64`; `docker compose up -d redis postgres insight proxy`; wait for
   health; `docker compose exec -T redis redis-cli MODULE LIST` names `search`, `ReJSON`, `timeseries`,
   `bf` (print the list; if any is missing the check FAILS, this is the single most important fact in
   Phase 0); `curl -fs http://localhost:${INSIGHT_PORT}/api/health/`; `curl -s -o /dev/null -w '%{http_code}'
   http://localhost:${PROXY_PORT}/` is 502 or 200; `docker run --rm <node image> node engine/dist/main.js`
   prints the package name; preflight exits 0 with `--quiet` when the stack is down and the ports are free
   (run it before `up`); then `docker compose down`. Print each verification.

**Facts about this Mac.** Docker Desktop is installed (CLI 29.x, Compose v5.6) but may not be running:
start it with `open -a Docker` and wait. **Port 6379 is taken by a local `redis-server`**; do not stop it.
Set `REDIS_PORT=6390` in your local `.env` for the check and make sure preflight reports the clash
correctly with the default. Keep `.env.example` defaults at 6379.

**Acceptance check.** `scripts/check/P0-02.sh` exits 0 and prints each verification including the
MODULE LIST output.

**Handoff complete when.** check passes; `docs/handoffs/P0-02.md` written with the check output, the
measured image sizes and build time, and anything about Docker Desktop settings a beginner will hit; no
files outside "Files owned" changed.

**Model.** sonnet
