# F-23: show-me panels you can touch

Shared rules: `docs/specs/_wave2-common.md`. Read it first.

## Goal
The show-me panels are the reward for passing a level: the thing you built, alive on screen. Make them
beautiful, make changes visible, and let the player play with the data once the level is passed.

## Build
1. **Restyle all nineteen panels** on the design system as one family (same card frame, key in mono, type
   pill, live light). When the data changes between two reads, the changed row or value flashes briefly, so a
   command typed in the terminal is seen landing in the panel.
2. **Hands-on mode** behind an `interactive` prop on `ShowMe` (the prop exists already and is ignored; default
   false). When true, these panels gain direct manipulation, each action sent through `api.cli` as one Redis
   command and shown under the panel as "ran: <command>" (mono, copyable):
   string (edit the value: `SET`), hash (edit or add a field: `HSET`), list (`LPUSH`, `RPUSH`, `LPOP`,
   `RPOP`), set (add or remove a member: `SADD`, `SREM`), leaderboard (plus and minus on a member:
   `ZINCRBY`), time to live (presets and a slider: `EXPIRE`, and `PERSIST`). The other panels stay read-only.
   Refuse to act on keys under the `game:` prefix (the engine's own).
3. **Practice gallery** (`/showme`): becomes "The nets", a sandbox where every panel is hands-on against
   sample keys under the `practice:` prefix, created on demand with one button and removable with another.
   Keep its current sample-data behaviour when the practice keys do not exist.
4. Errors from a command show inline in the panel, in plain words, and never break the panel.

## Files you own
`ui/src/showme/**`, `ui/src/screens/ShowMeGallery.tsx`, `ui/src/app/showme/**`, the existing tests
`ui/test/{showme,showmeF13}.test.tsx`, new `ui/test/handsOn*.test.ts(x)`, `scripts/check/F-23.sh`,
`docs/handoffs/F-23.md`.

## Keep working
`showme-panel`, `showme-title`, `ttl-left`, `insight-link` and every other test id in the panels; the
component ids in `SHOW_ME_IDS` (the engine's level files name them); the gallery count of nineteen. Command
building is pure functions with unit tests (quoting of values with spaces included).
