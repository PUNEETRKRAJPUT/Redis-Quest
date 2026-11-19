@AGENTS.md

# Redis Quest UI: conventions for every agent

The UI is a Next.js 16.4 App Router app (`src/app`). The rule in AGENTS.md is not optional: before you write
Next.js code, read the matching guide in `ui/node_modules/next/dist/docs/` (version-matched docs). Do not write
Next.js from memory.

## Shape
- **All game data is client-side.** Screens read the zustand store (`src/store.ts`), the engine API
  (`src/api.ts`, same-origin `/api/*`, `/health`) and one WebSocket (`src/ws.ts`, `/ws`). No server component
  fetches from the engine: every route is a static shell around client components, so the build never needs the
  engine and the page still renders when the stack is down.
- `cacheComponents`, `partialPrefetching` and `experimental.useOffline` are on (see `next.config.ts`). The learner
  stops the stack on purpose in some levels; nothing may crash or hard-navigate because of it.
- Interactive modules start with `'use client'`. Browser-only libraries (xterm, Monaco) load on the client only.
- Internal links go through `next/link` (or the project wrapper once it exists), never a hash link.
- Production: a compose service `ui` runs `.next/standalone/ui/server.js` on container port 3100; Caddy sends
  `/api/*`, `/health`, `/ws` to the engine, `/app/*` to the app, everything else to `ui`.

## Working rules
- A shared dev server is already running at http://127.0.0.1:3100 against an isolated stack (proxy on 3400).
  **Do not start another `next dev`, do not stop this one.** Its log: the path your brief names. Only the task
  that owns the build may run `next build`; everyone else uses `pnpm --filter @quest/ui exec tsc --noEmit`,
  `pnpm --filter @quest/ui test`, `pnpm --filter @quest/ui lint` and the dev server.
- Never touch the compose projects `redis-quest` (the owner's running game) or `quest-dev` (the shared backend).
- Stay inside the files your spec lists. `ui/package.json` belongs to one task at a time; ask in your handoff
  instead of adding a dependency.
- Unit tests render to static markup (no DOM). Keep modules importable under vitest.
- Every `data-testid`, role and label that `ui/e2e/*.e2e.ts` or `ui/test/*` uses must keep working.
- Design language: `docs/design/EXPERIENCE.md`. Tokens and primitives live in `src/design/`. No emojis as
  icons, visible focus rings, `prefers-reduced-motion` respected, no network requests beyond same-origin.
- Prettier (`pnpm exec prettier --write <files>`) and ESLint must be clean for every file you touch.
