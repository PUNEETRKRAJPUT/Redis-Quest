# D-06: your turn, the wanted-commands board, the credits

Rules for every day task: `docs/specs/_days-common.md`. Branch: `day-06-your-turn`, **cut from
`day-05-level-studio`**, not from `main`: it uses the studio's routes and its `studio_playtest_passed` event.
Read `docs/handoffs/D-05.md` on that branch first.

## Goal
Finishing the game turns a player into an author. The last thing the game asks for is a pull request.

## Build
1. **Your turn** (`/your-turn`): not a level and not part of the campaign's count. A short guided path with
   three steps that tick themselves off: pick a Redis command nobody teaches yet (the board below), write and
   play-test a level about it in the studio (the event from D-05), get the files and open a pull request (the
   exact commands, and a link to `CONTRIBUTING.md`, which another branch adds: link it without depending on
   it). Progress is remembered in `localStorage`. After the Finale is passed the map's feature card for it
   should read as the next thing to do; before that it is simply available.
2. **The wanted-commands board.** `GET /api/coverage` in `engine/src/features/coverage.ts`: every command name
   from the engine's command-docs snapshot (docs/handoffs/E-06.md), grouped by the server's own group, each
   marked taught or untaught. A command is taught when a campaign or community level's reference solution or
   checks use it (read how solutions are stored and how `scripts/grade/grade.mjs` finds them). Skip module
   commands the game leaves out (F-22's handoff says which and why). The board shows it: untaught first, the
   server's own summary beside each name, a "write a level about this" action that opens the studio with the
   command filled in. Everything on it comes from the running server and the level files; nothing by hand.
3. **Credits** (`/credits`): a scoreboard-style roll: the cast from `docs/fiction.md`, the authors of every
   community level (from `GET /api/community`), the people in a new `CONTRIBUTORS.md` at the repo root
   (a plain list a contributor adds their own line to; the engine serves it parsed through the coverage
   feature file), and the player's own line with their numbers. Skippable, keyboard friendly, still under
   reduced motion.
4. Turn both features on in their `entry.ts`.

## Files you own
`engine/src/features/coverage.ts` and new files under `engine/src/coverage/`, `CONTRIBUTORS.md`,
`ui/src/features/yourturn/**`, `ui/src/features/credits/**`, `ui/src/app/your-turn/**`,
`ui/src/app/credits/**`, tests, `scripts/check/D-06.sh`, `docs/handoffs/D-06.md`.

## How it will be verified later
On a running stack: the board's counts against `COMMAND LIST` on the same Redis; the three steps end to end.
