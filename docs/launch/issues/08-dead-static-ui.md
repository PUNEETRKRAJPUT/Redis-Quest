---
title: "Remove the engine's unused static-UI fallback"
labels: help wanted, engine, cleanup
---

**What.** The game's pages are served by the separate `ui` service (Next.js); Caddy sends `/api/*`, `/health`, `/ws` and `/internal/*` to the engine and everything else to `ui`. The engine still carries the old way: `uiDistDir` defaults to `ui/dist`, which does not exist any more (`ls ui/dist` fails), and `buildServer` registers `@fastify/static` and an `index.html` fallback only `if (haveUi)`, which is therefore never true outside tests that create a folder on purpose.

**Where to look.**
- `engine/src/config.ts`: `uiDistDir` and `UI_DIST_DIR`.
- `engine/src/server.ts`: the `// ---- static UI + SPA fallback` block near the end of `buildServer`, and the `@fastify/static` import at the top.
- Five engine tests pass a `uiDistDir` in their config: `questions.test.ts`, `ondemand-load.test.ts`, `command-docs.test.ts`, `pool.test.ts`, `interview.test.ts`.
- `docker/Caddyfile` for the routing the engine can rely on.

**Done when** the fallback block, the config field and the test fixtures' `uiDistDir` are gone, the engine still answers `404 not_found` for unknown paths, and `pnpm --filter @quest/engine build`, `lint` and `test` pass. Leave removing the `@fastify/static` dependency to a second pull request, because it changes `package.json` and the lockfile.

**Notes.** This touches several files, so it is a little bigger than the other starter issues. Ask in the thread before you start if anything is unclear.
