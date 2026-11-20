# D-09: Match Day

Rules for every day task: `docs/specs/_days-common.md`. Branch: `day-09-match-day`.

## Goal
A survival run the player can come back to: six overs of crowd traffic against their own build, with incidents
thrown in. The date is the seed, so everyone plays the same match on the same day, with no server.

## Build
1. **Read first**: `scenarios/` and its README, how the engine runs load (`engine/src/` load runner and the
   `/api/load/*` routes in `server.ts`), the caps (`LOAD_MAX_CONNECTIONS`, `LOAD_MAX_DURATION_SEC`, `LOW_POWER`),
   the `redis_busy` and `script_killed` events, and the chapter 4b levels (`levels/ch4b-on-call/`) for how
   faults are planted today.
2. **The incident deck** (`incidents/*.yaml`, a README for contributors, a schema and loader in
   `packages/shared/src/matchday/`): a card has a title, what the player sees, how the engine causes it using
   only things it can already do (switch the scenario, delete keys under a prefix the card names, lower and
   restore `maxmemory`, run a short blocking script), and how it ends. Five cards. Every change a card makes is
   undone when the match ends, also when it ends by an error.
3. **The match** (pure logic in `packages/shared/src/matchday/`: a seeded generator, the fixture for a seed,
   scoring): six overs, each one a scenario run of ten seconds within the caps, a card before some overs. An
   over scores runs from the share of requests answered without error, and loses a wicket when errors or the
   99th percentile cross the budget the fixture states. Scores are for the player's own machine: say so.
4. **Engine** (`engine/src/features/matchday.ts`, helpers under `engine/src/matchday/`):
   `GET /api/matchday` (today's fixture, the best results), `POST /api/matchday/start`, `GET
   /api/matchday/status`, progress pushed as level events. One match at a time; refused while a level check or
   a load run is going. Results go to a file of their own in the progress folder, not into `progress.json`.
5. **The screen** (`/matchday`): the fixture card for today (and "play another seed"), the war room during the
   match (overs as a scoreboard, the current card, requests per second and the 99th percentile from the metrics
   the store already has), the final scorecard in cricket form with a "copy as text" button.
6. Turn the feature on in `ui/src/features/matchday/entry.ts`.

## Files you own
`incidents/**`, `packages/shared/src/matchday/**` (and its export), `engine/src/features/matchday.ts`,
`engine/src/matchday/**`, `ui/src/features/matchday/**`, `ui/src/app/matchday/**`, tests,
`scripts/check/D-09.sh`, `docs/handoffs/D-09.md`.

## How it will be verified later
A full match on a running stack with chapter 2's cache in place, then `CONFIG GET maxmemory` and a key census
before and after to prove everything was put back.
