# F-16: the "Night match" design system

## Goal
Build the design system every screen will be rebuilt on: tokens, fonts, primitives, motion, sound, settings,
and a living gallery page. Read `docs/design/EXPERIENCE.md` first; it is the brief and it is binding.
Quality bar: this is a game people should want to screenshot. Crisp, confident, alive, never busy.

Context: `ui/` is a Next.js 16.4 App Router app with Tailwind 4 (`@tailwindcss/turbopack` loader,
`src/app/globals.css` imports `tailwindcss` then `src/design/tokens.css`). The root layout already puts
`fontClassNames` from `src/design/fonts.ts` on `<html>` and imports the legacy `src/styles.css` before
`globals.css`. Installed and ready: `motion`, `clsx`, `lucide-react`, `cmdk`, `react-resizable-panels`,
`zustand`, `@fontsource-variable/inter`, `@fontsource-variable/jetbrains-mono`, `@fontsource/barlow-condensed`.
Another task (F-14) is porting the old screens at the same time and owns the layout and the routes.

## Read first
`CLAUDE.md`, `ui/CLAUDE.md`, `ui/AGENTS.md`, then in `ui/node_modules/next/dist/docs/01-app/`:
`01-getting-started/{05-server-and-client-components,11-css,13-fonts}.md`,
`02-guides/{preventing-flash-before-hydration,view-transitions}.md`. Also the first 120 lines of
`ui/src/styles.css` (the legacy variables) and `ui/src/icons.tsx`.

## What to build (all under `ui/src/design/`)
1. **`tokens.css`:** the palette, type, radii, shadows and glows, durations and easings from the brief as a
   Tailwind 4 `@theme` (so `bg-night-900`, `text-chalk`, `font-display`, `ease-out-expo` and so on exist) plus
   base rules: page background with the floodlight glows and grain, selection colour, focus-visible ring,
   scrollbars, `color-scheme: dark`. The design is dark regardless of the OS setting.
   Also **re-declare every legacy custom property** from `styles.css` (`--bg`, `--surface`, `--ink`, `--accent`,
   `--ok`, `--bad`, `--mono`, `--sans`, ...) with the new values, for both colour schemes, so screens that are
   not redesigned yet already wear the new palette and fonts. Do not edit `styles.css`.
2. **`fonts.ts`:** self-hosted fonts from the installed packages (no font CDN, no build-time network), exposed
   as CSS variables and the `fontClassNames` string the layout already uses. Latin subset only.
3. **Primitives** (client components where needed, typed props, `className` passthrough, keyboard and screen
   reader correct): `Button` (primary, ghost, quiet, danger; sizes; loading), `IconButton`, `Card`, `Panel`
   (titled card with a header slot), `Pill` (status and tag), `Kbd`, `Tooltip`, `Dialog`, `Tabs`,
   `ProgressBar`, `Meter`, `Skeleton`, `EmptyState`, `Toaster` with a `toast()` function, `FlipNumber`
   (scoreboard digits that flip when the value changes), `Confetti` (canvas burst, fires on demand),
   `Floodlights` (the sweeping light effect for celebrations), `Scoreline` (label plus big tabular number).
4. **`motion.ts`:** durations, easings, shared `motion` variants (fade, rise, pop, stagger list) and a
   `useReducedMotion` hook that honours both the OS setting and the in-game setting.
5. **`sound.ts`:** a tiny WebAudio synthesiser with the cues from the brief (`tick`, `msg`, `tock`, `out`,
   `flip`, `roar`, `pager`), no audio files, created lazily on the first user gesture, `play(cue)` is a no-op
   when sound is off. Each cue should sound like what it is named for.
6. **`settings.ts`:** a zustand store persisted to `localStorage` (guarded for server render): `sound` (off by
   default), `volume`, `reducedMotion` (`system` | `on` | `off`).
7. **`index.ts`:** one import surface for all of the above.
8. **Gallery page `ui/src/app/design/page.tsx`** at `/design`: every token, every primitive in every state,
   buttons that play each sound cue and fire the confetti and floodlights. It doubles as the visual check.

## Files you own
`ui/src/design/**`, `ui/src/app/design/**`, `ui/test/design*.test.ts(x)` (new tests for pure logic: the cue
table, the settings store, FlipNumber digit maths, reduced-motion resolution), `scripts/check/F-16.sh`,
`docs/handoffs/F-16.md`. Do not touch anything else. You may not add dependencies; if you truly need one, stop
and say so in the handoff. Do not run `next build` or `next dev`.

## Verify
- `pnpm --filter @quest/ui exec tsc --noEmit`, `pnpm --filter @quest/ui lint`, `pnpm --filter @quest/ui test`.
- The shared dev server (http://127.0.0.1:3100, log path in your brief) serves `/design` without errors. Take
  headless Playwright screenshots (`pnpm --filter @quest/ui exec playwright`, Chromium is installed) of the
  whole gallery at 1440x900 and **look at them**: iterate until it is genuinely good. Check focus rings by
  tabbing, check the reduced-motion path, check contrast of text on every surface.
- `scripts/check/F-16.sh` (bash 3.2, exit 0, no Docker, prints what it verified): type check, lint, tests,
  every token in the brief's palette table is declared, every legacy variable from `styles.css` is re-declared,
  every primitive is exported from `index.ts`, no `fonts.googleapis.com` or other external URL in `ui/src/design`.

## Handoff
`docs/handoffs/F-16.md`: what you built, how to use it (a short cookbook for the screen tasks: tokens, the
primitives' props, `toast()`, `play()`, motion variants), screenshots' paths, what you did not do, surprises.
Do not commit. Do not edit `docs/BUILD.md`.
