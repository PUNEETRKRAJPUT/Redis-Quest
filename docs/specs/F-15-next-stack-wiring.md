# F-15: the stack serves the Next.js UI

## Goal
The Docker Compose stack runs the new UI as its own small service and the proxy routes to it. After this task
`./scripts/start` on a clean machine builds everything and http://localhost:3000 shows the Next.js app, with
the engine API, the WebSocket and the app routes working exactly as before.

Context: until now the UI was a Vite bundle (`ui/dist`) that the engine served itself. `ui/` is now a Next.js
16.4 app with `output: 'standalone'` and `outputFileTracingRoot` at the repo root, so `pnpm --filter @quest/ui
build` produces `ui/.next/standalone/ui/server.js` (plus `ui/.next/static`, which must be copied to
`ui/.next/standalone/ui/.next/static`, and `ui/public` if it exists). Another task (F-14) is porting the screens
at the same time; today the app has a placeholder page at `/`, which is enough for you to verify routing.

## Read first
`CLAUDE.md` (hard constraints: arm64 only, every service has `mem_limit`, no Docker socket, ports), `ui/CLAUDE.md`,
`ui/node_modules/next/dist/docs/01-app/02-guides/self-hosting.md` and
`03-api-reference/05-config/01-next-config-js/output.md`, `docker/node.Dockerfile`, `docker-compose.yml`,
`docker/Caddyfile`, `scripts/start`, `scripts/preflight.sh`, `.github/workflows/ci.yml`.

## What to build
1. **Image.** Keep one image for every Node service. The build stage runs the Next build; the runtime stage
   carries the standalone server with its static files instead of `ui/dist`. Keep the image small (the standalone
   output already contains the traced `node_modules`).
2. **Compose service `ui`.** Same image and platform as the other Node services, command runs the standalone
   server on container port 3100 (`HOSTNAME=0.0.0.0`, `PORT=3100`), no host port, `mem_limit: 384m`, no volumes it
   does not need, `NEXT_TELEMETRY_DISABLED=1`. It must not depend on Redis or Postgres being healthy: the UI has
   to come up and stay up when the learner stops them.
3. **Proxy.** `/app/*` to the app as today; `/api/*`, `/health` and `/ws` (WebSocket upgrade) to the engine;
   everything else to `ui:3100`. Check `engine/src/server.ts` for any other engine path a browser or a script
   reaches through the proxy and route it too. While `ui` is still starting the proxy answers 502 for pages; that
   is acceptable, as it is for the engine.
4. **Engine.** It already runs API-only when `ui/dist` is absent. Do not change engine source unless a check
   proves it necessary; say so in the handoff if you do.
5. **Scripts and docs.** `scripts/start` and `scripts/preflight.sh` messages and readiness waits include the UI
   (the game is ready when `/` answers 200 through the proxy and `/health` is ok). Update the memory budget line
   in `docs/PLAN.md` section 2, the stack line in `CLAUDE.md` (Next.js replaces Vite), and the service table and
   any Vite mention in `README.md` (format README with
   `pnpm exec prettier --write --ignore-path /dev/null README.md`; `scripts/check/C-POL.sh` must still pass).
6. **CI.** `.github/workflows/ci.yml` must still build, lint, format-check and test everything; set
   `NEXT_TELEMETRY_DISABLED=1`.
7. **Checks that build or probe the stack.** `ui/e2e/compose.p10.yml` and any `scripts/check/*.sh` that assume the
   engine serves the UI or that grep `ui/dist` output must work with the new layout (do not rewrite the e2e
   tests themselves, another task does). List every check you changed in the handoff.

## Safety (read twice)
- The owner's game is running as compose project `redis-quest`, and a shared development backend runs as
  `quest-dev`. **Never run a compose command without `-p <your own project>`, never touch those two projects,
  and never build or tag `redis-quest-node:latest`**: verify with your own project (for example `quest-f15`),
  your own image tag (use a compose override file), your own ports (for example proxy 3500, redis 6395,
  postgres 5437, insight 5545), and scratch directories for progress, workspace and logs (see how
  `scripts/check/P0-10.sh` and `ui/e2e/compose.p10.yml` isolate a stack). Remove your project with
  `docker compose -p quest-f15 down -v` when done.
- Do not run `next dev`. Do not edit anything under `ui/src`.

## Files you own
`docker/node.Dockerfile`, `docker/node.Dockerfile.dockerignore`, `docker-compose.yml`, `docker/Caddyfile`,
`scripts/start`, `scripts/stop`, `scripts/reset`, `scripts/preflight.sh`, `.github/workflows/ci.yml`,
`docs/PLAN.md`, `README.md`, `CLAUDE.md`, `ui/e2e/compose.p10.yml`, existing `scripts/check/*.sh` where they
assume the old layout (not the e2e test files), `scripts/check/F-15.sh`, `docs/handoffs/F-15.md`.

## Verify
`scripts/check/F-15.sh` (bash 3.2, exit 0, prints what it verified): builds the image under its own tag, starts
its own isolated project, then proves through the proxy that `/` returns the Next.js page (HTML with
`/_next/` assets that load with 200), `/health` and `/api/chapters` come from the engine, `/app/health` (or the
app's real health route) comes from the app, a WebSocket to `/ws` upgrades, the `ui` container stays up and
serves `/` after `docker compose stop redis`, every service has a `mem_limit`, every image is arm64; then tears
the project down. Paste its output in the handoff. Also report the image size before and after, and the UI
container's memory after a minute (`docker stats --no-stream`).

## Handoff
`docs/handoffs/F-15.md`: what you did, commands and results, what you did not do, surprises, what the next agent
must know. Do not commit. Do not edit `docs/BUILD.md`.
