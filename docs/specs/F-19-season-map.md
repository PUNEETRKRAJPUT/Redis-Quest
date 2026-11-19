# F-19: the season map and the caps shelf

Shared rules: `docs/specs/_wave2-common.md`. Read it first.

## Goal
The home screen stops being a list. It is the league season on a night campus, and it always answers one
question first: what do I play next?

## Build
1. **Next match** (the one loud thing): the next playable level (first `in_progress`, else first `available`)
   as a hero card with its chapter, the incident's first message as the headline, mode, XP, and one primary
   action ("Play" or "Continue"). When everything is passed, a season-complete card instead.
2. **Season path:** the chapters in order along a floodlit path (SVG or CSS, your call, it must be crisp and
   cheap to render). Each chapter is a match-night fixture: number, title, incident headline, progress
   ("5 of 16"), and its levels as balls in overs of six using `ballFor` from `src/game/outcome.ts` (symbol,
   tone, and the plain label as tooltip and accessible name). The current ball pulses. Passed chapters are
   lit, future ones are dim.
3. **Fixture detail:** opening a chapter shows its levels as rows (title, mode, XP, status), links to
   `/level/<id>` for unlocked levels, and "Read the chapter thread" which shows the incident with the existing
   `Thread` component (`src/level/Thread.tsx`, another task upgrades it in place; use its current props).
4. **Scoreboard strip:** total XP (`xp` test id), rank and progress to the next rank (`src/game/rank.ts`),
   levels passed out of total.
5. **Caps shelf:** `progress.badges` as collectible enamel caps: a generated emblem per badge (deterministic
   from the badge name: shape, colour pair from the palette, initials), newest first, the name on hover and
   for screen readers, a count. An empty shelf invites the first cap.

## Files you own
`ui/src/screens/ChapterMap.tsx`, `ui/src/map/**`, `ui/src/app/page.tsx`, `ui/test/map*.test.ts(x)`,
`scripts/check/F-19.sh`, `docs/handoffs/F-19.md`.

## Keep working
`chapter-map`, `xp`, `chapter-<id>`, `level-<id>` (a link when unlocked, not a link when locked), the greeting
with the player's name, the error state when chapters cannot be loaded.
