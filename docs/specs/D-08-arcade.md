# D-08: the arcade, and its first cabinet

Rules for every day task: `docs/specs/_days-common.md`. Branch: `day-08-arcade`. This task is all UI.

## Goal
Some things about Redis are easier to feel than to read. An arcade cabinet is a one-minute game that makes the
player *be* a part of Redis. The first one: **Be the Redis.**

## Build
1. **The kit** (`ui/src/features/arcade/kit/`): what a cabinet is (id, title, one-line pitch, the lesson in one
   sentence, its component, and its `facts`: every rule of the game with the place in
   `docs/redis-docs-digest.md` it comes from, or the words "a simplification" and what is simplified), a
   shared frame (title, score, timer, pause, restart, "what this teaches" panel, keyboard help), a fixed-step
   game loop with a seeded random source so a run can be replayed, and a best-score store in `localStorage`.
   `docs/arcade.md` tells a contributor how to add a cabinet in one folder.
2. **Be the Redis** (`ui/src/features/arcade/cabinets/be-the-redis/`): commands arrive from clients on a belt.
   The player runs them one at a time (Space or click): Redis runs commands one after another. Each command
   takes a number of ticks that depends on its documented complexity and on the size of the key it touches
   (shown on the card), so an `O(1)` read is instant and a command that walks a big key holds everything behind
   it. Waiting clients grow impatient; the score is how many were served in time. The player can swap a slow
   command for its incremental cousin when one is offered (the digest names the pairs). The summary and the
   complexity text on every card are the server's own, from the engine's command docs
   (`GET /api/command-docs`, docs/handoffs/E-06.md), with a built-in fallback set of cards that is clearly a
   copy of the same data for when the stack is down. The tick model is a simulation and the cabinet says so.
   After the round: what happened, in two sentences, and the one idea to take away.
3. **The arcade** (`/arcade`): the cabinets as a row of machines, best scores, a second cabinet shown as
   "coming: be the eviction policy" with a link to `docs/arcade.md`.
4. Keyboard playable, readable at 1280 wide, still under reduced motion (the belt steps instead of sliding),
   sound through the design system. Pure game logic (the queue, the tick cost, scoring, the seeded source) lives
   in plain functions with tests.
5. Turn the feature on in `ui/src/features/arcade/entry.ts`.

## Files you own
`ui/src/features/arcade/**`, `ui/src/app/arcade/**`, `docs/arcade.md`, tests, `scripts/check/D-08.sh`,
`docs/handoffs/D-08.md`.

## How it will be verified later
By playing it. List in the handoff every rule and its digest line, so the facts can be checked without playing.
