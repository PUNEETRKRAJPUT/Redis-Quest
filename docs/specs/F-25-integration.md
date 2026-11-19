# F-25: integration: end-to-end tests, checks, and the old stylesheet

## Goal
After the screens are rebuilt, the whole game is proven again: the browser tests play it, every check script
that looks at the UI passes, the legacy stylesheet is gone, and the README shows the new game.

## Read first
`CLAUDE.md`, `ui/CLAUDE.md`, `ui/AGENTS.md`, `docs/design/EXPERIENCE.md`, every handoff from F-14 to F-24
(each lists changed test ids, texts and anything left open), `ui/e2e/*.e2e.ts`, `ui/playwright.config.ts`,
`scripts/check/P0-10.sh`, and the check scripts that mention the UI
(`grep -ln "ui/" scripts/check/*.sh`).

## Build
1. **End-to-end tests** (`ui/e2e/*.e2e.ts`): make them play the new UI. Prefer keeping the test and fixing a
   lost test id in the component (tell me which) over rewriting the test. Add coverage for what is new and
   stable: real routes and the legacy hash redirect, the command palette opening and jumping to a level, the
   rain-delay strip appearing when the engine is unreachable, the welcome flow, the verdict overlay.
2. **`scripts/check/P0-10.sh`** runs green against its own isolated stack (it builds the image; the stack
   wiring from F-15 is merged).
3. **Every other check that greps or builds the UI** passes; fix the check where it asserts the old layout,
   fix the UI where the check caught a real regression. List each in the handoff with which side you fixed.
4. **Legacy stylesheet:** remove `ui/src/styles.css` and its import once no markup needs it (search for every
   class it defines). If something still needs a rule, move that rule next to its component.
5. **README images** in `docs/img/` retaken from the new UI (same five file names, 800x600 JPG, from the
   isolated stack, never the owner's game) and any README sentence that describes the old screens corrected
   (format with `pnpm exec prettier --write --ignore-path /dev/null README.md`; `scripts/check/C-POL.sh`
   must pass).
6. **Accessibility and polish pass** over every route at 1440x900 and 1280x800: focus order, contrast, no
   overflow, no console errors, no layout shift on load. Fix what you find, or list it with the file.

## Safety
Use only compose projects you create with your own name, ports and scratch directories (the check scripts
already do). Never touch `redis-quest` or `quest-dev`, never run `scripts/start|stop|reset` bare.
You may run `pnpm --filter @quest/ui build`.

## Files you own
`ui/e2e/**`, `ui/playwright.config.ts`, `ui/src/styles.css`, existing `scripts/check/*.sh` where they assert
the UI, `docs/img/**`, `README.md` (UI sentences only), small fixes anywhere under `ui/src` that the tests
prove necessary (name each in the handoff), `scripts/check/F-25.sh`, `docs/handoffs/F-25.md`.

## Verify
`scripts/check/F-25.sh`: build, lint, unit tests, `scripts/check/P0-10.sh`, the UI-related checks, no import
of `styles.css` left, the five images exist at 800x600. Paste the output in the handoff. Do not commit.
Do not edit `docs/BUILD.md`.
