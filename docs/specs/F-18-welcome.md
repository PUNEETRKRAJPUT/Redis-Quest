# F-18: the first five minutes

Shared rules: `docs/specs/_wave2-common.md`. Read it first.

## Goal
The first run feels like the opening scene of a game, takes under a minute, and can be skipped in one key.

## Build
1. **Opening scene** (shown when the store's boot state is `welcome`): the title under floodlights, then the
   first lines of the story arriving as chat messages (use the chapter 0 incident from `GET /api/chapters` if
   it is available without a player; if it is not, use two short lines you write in the same voice as
   `docs/fiction.md`), then the name form. "Skip intro" (Escape) jumps straight to the form. Under reduced
   motion the scene is a single still.
2. **Name form:** same field, validation, error handling and submit as today (`createPlayer`), same test ids
   (`welcome`, `player-name`, `player-submit`). Add a jersey colour picker (six swatches from the palette)
   stored in a small persisted store `src/onboarding/profile.ts`, and the one-time sound question (sets the
   design system's sound setting). Both are optional and cosmetic.
3. **Kick-off:** after the player is created, a two-second "Welcome to the league, <name>" beat (skippable),
   then the game.

## Files you own
`ui/src/screens/Welcome.tsx`, `ui/src/onboarding/**`, `ui/test/welcome*.test.ts(x)`,
`scripts/check/F-18.sh`, `docs/handoffs/F-18.md`.

## Note
The shared backend already has a player, so the welcome state does not appear there. Verify by intercepting
`GET /api/progress` in Playwright to answer 404 `{"error":"no_player"}` and `POST /api/player` to answer a
fake progress object; do not delete the shared player.
