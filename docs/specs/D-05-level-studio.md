# D-05: the level studio and community levels

Rules for every day task: `docs/specs/_days-common.md`. Branch: `day-05-level-studio`. D-06 builds on this
branch, so finish the engine routes and the events it needs first and push early.

## Goal
A player can write a level in the game, play-test it against the real engine, and get the files ready to send
as a pull request. Levels written by others can be played. The campaign itself does not change.

## Build
1. **Read first**: `levels/README.md`, `packages/shared/src/levels/` (schema, loader, validator with positioned
   errors), `engine/src/levels.ts`, how verify works (`engine/src/verify/`), `scripts/grade/grade.mjs`.
2. **Community levels on disk**: `levels/community/<pack>/` holds level files in the existing format plus a
   required `author: { name, github? }` (new optional field in the schema; required by the community loader).
   They are loaded separately from the campaign: no XP, no badges, never locked, not in `GET /api/chapters`,
   not in the season map, and not counted in "96 levels". Ship one small sample level by "the house" so the
   path is exercised. A broken community level must never stop the engine: it is listed with its errors.
3. **Engine routes** in `engine/src/features/studio.ts` (helpers in new files beside it):
   `GET /api/community` (packs, levels, authors, errors), the routes a level screen needs for a community level
   (reuse the campaign's code paths; decide whether the level service loads them as a flagged extra or a second
   service, and say why), `POST /api/studio/validate` (a draft as JSON, the validator's positioned errors back),
   `POST /api/studio/playtest` (load the draft in memory, run its setup, run its reference solution, run its
   verifiers, return the checks, delete what the draft created; refuse a draft that touches `game:*`). Emit a
   level event `studio_playtest_passed` when a play-test passes (D-06 listens for it).
4. **The studio** (`/studio`): write a `cli` or a `decision` level without touching YAML: the incident chat,
   story, teaching text, task, hints, checks picked from a list with a small form each, the reference solution,
   the author. A live preview. "Play-test" shows the same checks a player would see. "Get the files" downloads
   them and shows the three git commands and where the files go. Drafts survive a reload (`localStorage`).
5. **Community page** (`/community`): the list from the engine with author bylines; a level opens in the
   normal level screen.
6. **`scripts/level-new`**: a scaffolder for people who prefer files (asks nothing: flags for pack, id, mode).
7. Turn both features on in their `entry.ts`.

## Files you own
`engine/src/features/studio.ts` and new files under `engine/src/community/`, the `author` field in
`packages/shared/src/levels/schema.ts` and new files under `packages/shared/src/levels/` for the community
loader, `levels/community/**`, `scripts/level-new`, `ui/src/features/studio/**`, `ui/src/features/community/**`,
`ui/src/app/studio/**`, `ui/src/app/community/**`, tests, `scripts/check/D-05.sh`, `docs/handoffs/D-05.md`.
If the level screen needs a small change to open a community level, name it in the handoff and make it.

## How it will be verified later
`scripts/check/G-01.sh` must still report the same totals; then the studio by hand: write a level, fail a
play-test, pass it, download, drop the files in `levels/community/`, see it on `/community`, play it.
