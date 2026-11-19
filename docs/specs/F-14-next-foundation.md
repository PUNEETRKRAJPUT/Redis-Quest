# F-14: the UI runs on Next.js (App Router) with full parity

## Goal
Replace the Vite single-page app in `ui/` with a Next.js 16.4 App Router app that does everything the old UI
did. This task is a port, not a redesign: reuse the existing components and the legacy `src/styles.css`.
Other tasks redesign each screen right after this one, so do not polish visuals here.

A skeleton already exists and builds: `ui/next.config.ts` (standalone output, Cache Components, Partial
Prefetching, `experimental.useOffline`, dev rewrites to the stack's proxy), `ui/tsconfig.json`,
`ui/src/app/{layout.tsx,page.tsx,globals.css}`, `ui/AGENTS.md`, `ui/CLAUDE.md`. Dependencies are installed.

## Read first
`CLAUDE.md`, `ui/CLAUDE.md`, `ui/AGENTS.md`, then in `ui/node_modules/next/dist/docs/01-app/`:
`01-getting-started/{02-project-structure,03-layouts-and-pages,04-linking-and-navigating,05-server-and-client-components}.md`,
`02-guides/{single-page-applications,lazy-loading,preserving-ui-state,offline-support,instant-navigation,testing/vitest}.md`,
and the API reference pages for `dynamic-routes`, `cacheComponents`, `use-offline`, `next/link`.
The old app is the behaviour spec: `ui/src/App.tsx`, `ui/src/router.ts`, `ui/src/main.tsx`.

## What to build
1. **Routes** (pages are static shells that render client screens):
   `/` map (old `#/`), `/level/[id]`, `/terminal`, `/editor`, `/logs`, `/metrics`, `/built`, `/showme`.
   The dynamic level route must work for any id at run time (levels can be added later) and must pass the
   Cache Components build validation without a server-side engine call.
2. **Game shell** (`src/shell/GameShell.tsx`, client): what `App` did. Starts the store (`init`) and the socket
   once, keeps retrying while `boot === 'offline'`, renders the boot states (`loading`, `welcome`, `offline`,
   `invalid`) and, when ready, the skip link, the header with navigation and status, the mirror banner and the
   page. Mounted from the root layout so it survives navigation. Keep every `data-testid` and label.
3. **Links:** `src/shell/QuestLink.tsx` wraps `next/link`. Replace every hash link (`#/...`, `hrefFor`) in
   `ui/src` with real paths. Keep the route helpers in `src/routes.ts` (path for a route, parse a legacy hash).
4. **Legacy hash redirect:** loading `/#/level/x`, `/#/terminal` and so on replaces the URL with the real route.
5. **WebSocket in development:** the dev server on 3100 does not proxy `/ws`. In development the socket connects
   to the stack's proxy port directly (expose it with a `NEXT_PUBLIC_` variable set from `PROXY_PORT` in
   `next.config.ts`); in production it stays same-origin. The header must show `live` on the dev server.
6. **Monaco and xterm under Turbopack:** `src/panels/MonacoEditor.tsx` uses a Vite-only `?worker` import.
   Make the bundled, offline Monaco work under Turbopack (no CDN loader), client-only. xterm likewise.
7. **Remove the Vite app:** delete `ui/index.html`, `ui/vite.config.ts`, `ui/src/main.tsx`, `ui/src/App.tsx`,
   `ui/src/router.ts`. Add `ui/vitest.config.ts` so `pnpm --filter @quest/ui test` still runs every existing
   test (stub `next/link` and `next/navigation` for vitest if a component under test needs them).
8. **Stack-down behaviour:** with the engine unreachable the shell shows the offline state and recovers alone;
   client navigation between routes must not crash or hard-fail (see `offline-support.md`).

## Files you own
`ui/src/app/**` except `ui/src/app/design/**`; `ui/src/shell/**`; `ui/src/routes.ts`; `ui/src/ws.ts`;
`ui/src/panels/MonacoEditor.tsx`; `'use client'` and link edits anywhere in `ui/src/**` except `ui/src/design/**`;
`ui/vitest.config.ts`; `ui/test/**` (existing tests only); `ui/package.json`; `ui/next.config.ts`;
`ui/tsconfig.json`; the deleted Vite files; `scripts/check/F-14.sh`; `docs/handoffs/F-14.md`.
Do not touch: `docker/**`, `docker-compose.yml`, `.github/**`, `scripts/**` other than your check,
`ui/src/design/**`, `ui/src/styles.css`, `ui/e2e/**`, `ui/playwright.config.ts`.

## Verify
- `pnpm --filter @quest/ui build` succeeds and lists the eight routes. You are the only task allowed to run it.
- `pnpm --filter @quest/ui lint` and `pnpm --filter @quest/ui test` pass (84 tests or more).
- Against the shared dev server (http://127.0.0.1:3100, backend already populated with a player and 24 passed
  levels): every route renders, the header shows `live`, the terminal answers `PING`, the editor opens a
  workspace file and saves, a level page loads and can be checked, logs and metrics update. Use Playwright
  (already installed, `pnpm --filter @quest/ui exec playwright`) headless to load pages and take screenshots,
  and look at them. Read the dev log for errors.
- `scripts/check/F-14.sh` (bash 3.2, exit 0, prints what it verified, no Docker): build, lint, tests, the
  routes exist in the build output, the Vite files are gone, no `#/` links remain in `ui/src`.

## Handoff
`docs/handoffs/F-14.md`: what you did, commands and results, what you did not do, surprises (especially
anything in Next.js 16.4 that differed from what you expected), and what the screen tasks must know (how to add
a route, where the shell lives, how tests stub Next). Do not commit. Do not edit `docs/BUILD.md`.
