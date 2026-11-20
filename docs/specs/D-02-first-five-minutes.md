# D-02: the first five minutes, the rest

Rules for every day task: `docs/specs/_days-common.md`. Branch: `day-02-first-five-minutes`.
The opening scene, the live thread, the map, sound and the palette already exist (handoffs F-17 to F-20).

## Build
1. **A start page while the stack comes up.** Today the first start is minutes of terminal output and then a
   URL. Make `http://localhost:3000` useful from the first seconds: `scripts/start` starts the proxy first,
   writes its current stage (preflight, building, starting, ready, with times) to a small JSON file under the
   logs folder that the proxy already mounts, opens the browser once (`open`, macOS), and carries on. The proxy
   serves a self-contained page from `docker/starting/` whenever the UI service is not answering, keeping the
   error status code it sends today (other checks assert it: `grep -rn "502\|503" scripts/check`). The page
   reads the stage file, says in plain words what is happening and how long it usually takes, and loads the
   game by itself when it is ready. It works with JavaScript off (a meta refresh). You may add the read-only
   mount for `docker/starting/` to the proxy service in `docker-compose.yml`; nothing else there.
2. **Reply choices in chapter threads.** A message from the player may carry `choices`: two or three ways to
   say the same thing. The schema (`packages/shared/src/levels/schema.ts`) accepts them only on the player's own
   messages; the validator says so with a positioned error. The thread shows the choices as chips when that
   message is due, sends the chosen one, and remembers it per thread in `localStorage`; skip and reduced motion
   use the first choice. Add choices to the eight `levels/*/chapter.yaml` threads where the player already
   speaks: the existing line stays as the first choice and no message is added or removed.
3. **Commentary.** A line of cricket commentary for moments in the game (a pass, a fail, a works-but-wrong, a
   chapter finished, a dangerous command, the stack going down and coming back). Lines live in one JSON file
   per language under `ui/src/commentary/` (Hinglish first, then plain English), several per moment, picked in
   rotation. The player chooses `hinglish`, `english` or `off` (a new setting in `ui/src/design/settings.ts`,
   which this task may edit, and an entry in the command palette's settings group through the same store).
   Commentary is secondary text under the plain message, never a replacement for it.

## Files you own
`scripts/start`, `docker/Caddyfile`, `docker/starting/**`, the proxy mount in `docker-compose.yml`,
`packages/shared/src/levels/schema.ts` and its tests for `choices`, the `incident` blocks of
`levels/*/chapter.yaml`, `ui/src/thread/**`, `ui/src/level/Thread.tsx`, `ui/src/commentary/**`,
`ui/src/shell/eventToasts.ts`, `ui/src/shell/CommandPalette.tsx` (one settings item), `ui/src/design/settings.ts`,
one call site in `ui/src/match/` for the verdict's commentary line, tests, `scripts/check/D-02.sh`,
`docs/handoffs/D-02.md`.

## How it will be verified later
The start page needs a real `./scripts/start` in an isolated project (see how `docs/DAYS.md` describes the
fresh-clone test) and the content checks `scripts/check/C*.sh` for the thread edits.
