# Wave 2 (F-17 to F-24): rules every screen task shares

Each task rebuilds one area of the UI on the "Night match" design system. Your own spec names your files.

## Read first, in this order
1. `CLAUDE.md`, `ui/CLAUDE.md`, `ui/AGENTS.md`. The AGENTS.md rule is binding: read the version-matched
   Next.js docs in `ui/node_modules/next/dist/docs/` for anything Next-specific before you write it.
2. `docs/design/EXPERIENCE.md` (the brief) and `docs/handoffs/F-16.md` (the design system cookbook).
   Use the tokens and primitives from `ui/src/design`; do not invent a parallel set of colours or buttons.
3. `docs/handoffs/F-14.md` (how routes, the shell, links and test stubs work).
4. The files you are rebuilding, and every place `ui/e2e/*.e2e.ts` and `ui/test/*` touch them.

## Rules
- **Behaviour is frozen, presentation is yours.** Keep every API call, store interaction, state machine and
  edge case of the code you rebuild. Keep every `data-testid`, role, label and visible text that the tests or
  the e2e files rely on. If a test must change because markup moved, change the test minimally and say so.
- Stay inside your file list. Shared modules (`src/store.ts`, `src/api.ts`, `src/types.ts`, `src/ws.ts`,
  `src/icons.tsx`, `src/styles.css`, `src/design/**`, `src/game/**`, `ui/package.json`, `ui/next.config.ts`)
  are read-only for you; if you need a change there, describe it in your handoff instead. New icons come from
  `lucide-react`.
- Style with Tailwind utilities and the design tokens. Do not add rules to `src/styles.css`; if you need
  component CSS, put a CSS module next to the component. Stop using legacy class names in the markup you
  rebuild (a later task deletes the legacy stylesheet), except where a test asserts one.
- Motion and sound come from `src/design` (`motion.ts`, `play()`); honour reduced motion and the sound setting.
- Seven other agents edit other files in this checkout at the same time. A type or lint error in a file that
  is not yours is not yours to fix: wait and retry. Judge your work by errors in your own files.
- A shared dev server runs at http://127.0.0.1:3100 against an isolated backend (proxy on 3400, player
  "Asha", 24 levels passed, `ENGINE_DEV=1`). Do not start or stop a dev server, do not run `next build`, never
  run docker or compose commands or `scripts/start|stop|reset`, never use port 3000.
- Temporary files go in your scratch directory (your brief names it), never in the repo.

## Verify (every task)
- `pnpm --filter @quest/ui exec tsc --noEmit` (your files clean), `pnpm --filter @quest/ui lint`,
  `pnpm --filter @quest/ui test`.
- Headless Playwright against the dev server (`pnpm --filter @quest/ui exec playwright`, one browser at a
  time, close it when done): screenshots at 1440x900 and 1280x800, the keyboard path, the reduced-motion path.
  Open the screenshots and judge them against the brief; iterate until the screen is genuinely good.
- `scripts/check/<id>.sh` (bash 3.2, no Docker, exit 0, prints what it verified): type check, lint, tests, and
  greps that prove your test ids and key pieces exist.
- `docs/handoffs/<id>.md`: what you built, how you verified (commands, results, absolute screenshot paths),
  what you did not do, surprises, what the integration task must know (changed test ids or text).
  Do not commit. Do not edit `docs/BUILD.md`.
