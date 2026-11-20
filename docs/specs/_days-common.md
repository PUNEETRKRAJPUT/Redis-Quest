# The ten-day plan (D-01 to D-10): rules every day task shares

The plan and its live status are in `docs/DAYS.md`. Your own spec names your files. Read this file first.

## Mode: code only, no local runs
The owner's Mac is short on memory and disk. Until `docs/DAYS.md` says otherwise:
- **Do not run** Docker or `docker compose`, a dev server (`next dev`), a build (`next build`, `pnpm -r build`),
  Playwright, a test suite, a check script that starts anything, or `scripts/start|stop|reset`.
- **You may run** `pnpm install --frozen-lockfile --offline` once in your worktree, `scripts/dev/check.sh <package>`
  (type-check and lint under a machine-wide lock; for `@quest/shared` it builds, because the other packages
  import its output), and `pnpm exec prettier --write <files you touched>`.
- Write unit tests for your pure logic. **Do not run them**: CI runs them on the pull request.
- Because you cannot run your code: read every function you call before you call it, copy the patterns that are
  already in the file you extend, keep modules small and typed, and prefer pure functions. Do not guess an API.

## Resumable by design
Any session may be cut off at any moment. So:
- Work only on your branch, in your worktree. Never commit to `main`, never touch another branch.
- Commit after every milestone (`D-0n: <what>`, each ending with the line
  `Co-Authored-By: puneets-hermes-agent <puneets-hermes-agent@users.noreply.github.com>`), and push right after
  each commit: `git push git@github-personal:PUNEETRKRAJPUT/Redis-Quest.git <your branch>`. Push nothing else.
- `docs/handoffs/D-0n.md` exists from your first commit and is always current, with these sections:
  **Status** (one of: in progress, code complete and unverified), **Done**, **Remaining**, **Assumptions I
  could not check**, **How to verify** (exact commands and clicks for the session that will run it later),
  **Decisions and surprises**.
- `scripts/check/D-0n.sh` (bash 3.2, exit 0, prints what it verified) is written but not run. It may assume
  Docker and a stack are available; if it drives Compose it must use `scripts/check/lib/isolate.sh`
  (`scripts/check/G-03.sh` enforces that in CI).

## Boundaries
- Stay inside the files your spec lists. Read-only for everyone unless a spec says otherwise:
  `engine/src/server.ts`, `engine/src/features/index.ts`, `ui/src/features/registry.ts`,
  `ui/src/features/types.ts`, other tasks' folders, `ui/src/shell/**`, `ui/src/design/**`, `ui/src/store.ts`,
  `ui/src/api.ts`, `ui/src/types.ts`, `ui/src/routes.ts`, every `package.json`, `pnpm-lock.yaml`,
  `docker-compose.yml`, `docs/BUILD.md`, `docs/DAYS.md`, `.claude-session-cache.md`, and the campaign's level
  files. No new dependencies: if you need one, say so in the handoff and do without.
- Engine routes go in your file under `engine/src/features/` (see `index.ts` there): `api` already has the
  `/api` prefix. A new screen is a route folder under `ui/src/app/` plus your folder under `ui/src/features/`;
  you turn it on by setting `enabled: true` in your `ui/src/features/<id>/entry.ts`. The map and the command
  palette then link to it by themselves.
- The campaign does not change: eight chapters, 96 levels, their XP and badges, and what `GET /api/chapters`
  returns.

## House rules (from CLAUDE.md, ui/CLAUDE.md, ui/AGENTS.md; read them)
- Next.js 16.4 is not the Next.js you remember: read the matching guide under
  `ui/node_modules/next/dist/docs/` before writing anything Next-specific. Pages are static shells that render
  a client screen and carry `export const instant = false` (docs/handoffs/F-14.md).
- Design: `docs/design/EXPERIENCE.md` and the cookbook in `docs/handoffs/F-16.md`. Tokens and primitives from
  `ui/src/design`; `data-ds=""` on the root of a screen; no emojis as icons (lucide-react); visible focus;
  reduced motion and the sound setting honoured; nothing leaves the origin.
- Never invent a Redis fact. Anything the game states about Redis comes from `docs/redis-docs-digest.md`, from
  the running server's own `COMMAND DOCS` (the engine serves them: docs/handoffs/E-06.md), or is labelled as a
  simulation or as "measured on this stack". The key prefix `game:*` belongs to the engine.
- No AI, vector or LLM content. Apple Silicon Mac only. Scripts: bash 3.2 and BSD tools.
- A bare `docker compose` here targets the owner's real game. Never run one; never write a check that does.

## Your final message
A short factual report: branch and last commit hash, what is done, what remains, the assumptions you could
not check, and anything you need changed in a file you do not own.
