# F-17: the scoreboard shell

Shared rules: `docs/specs/_wave2-common.md`. Read it first.

## Goal
The frame of the game: a scoreboard top bar, keyboard-first navigation, a command palette, live toasts, and
the "rain delay" state when the stack is down.

## Build
1. **HUD** (replaces the header): brand mark, primary navigation (Map, Terminal, Editor, Logs, Metrics, What
   you built) with the active route marked, and on the right a scoreboard cluster: stack-status light (`live`,
   `reconnecting`, `redis down`, same meanings and aria labels as today), player name, rank title from
   `src/game/rank.ts`, XP as `FlipNumber` that flips and plays `flip` when XP changes, a thin progress line to
   the next rank with a tooltip ("175 XP to District pick"), a sound toggle and a "?" shortcuts button.
2. **Command palette** (`cmdk`, opens with Cmd+K or Ctrl+K and from a HUD button): go to any screen, jump to
   any level by title (from the store's chapters; locked levels are shown disabled), toggle sound, toggle
   reduced motion, open the shortcuts sheet. `tick` on move.
3. **Shortcuts:** `g` then `m` map, `t` terminal, `e` editor, `l` logs, `x` metrics, `b` what you built;
   `?` opens a shortcuts sheet (`Dialog`). Never fire while the user types in an input, the terminal or Monaco.
4. **Rain delay:** when the socket is not open or Redis is down while the game is ready, a calm strip under the
   HUD: what is wrong in plain words, the exact command that fixes it (`./scripts/start` for the stack,
   `docker compose start redis` when only Redis is down), and a short "Play resumes" confirmation when it is
   back. Use `useOffline` from `next/offline` as an additional signal. The boot states get the same
   treatment: `loading` (floodlights warming up), `offline` (full-page rain delay, keeps retrying), `invalid`
   (the level-file errors as a readable list). Keep their test ids and texts.
5. **Mirror banner** restyled, same behaviour and test id.
6. **Event toasts:** `level.event` messages from the store become short toasts (one line: what happened), and
   a dangerous command (`store.dangerous`) becomes a warning toast with `pager`. No toast storms: collapse
   repeats within two seconds.
7. **Route transitions:** a quick cross-fade between routes using the documented view-transition support
   (read `02-guides/view-transitions.md`), disabled under reduced motion.

## Files you own
`ui/src/shell/**`, `ui/src/app/layout.tsx`, `ui/test/shell*.test.ts(x)`, `scripts/check/F-17.sh`,
`docs/handoffs/F-17.md`. The page files under `ui/src/app/*/page.tsx` belong to other tasks.

## Keep working
Skip link, `mirror-banner`, `offline`, `levels-invalid`, the nav links by role and name (`Terminal` exact),
`aria-current` on the active link, the status wording.
