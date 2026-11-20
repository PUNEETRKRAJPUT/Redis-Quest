# D-03: more hands-on panels, and completion for the Redis client

Rules for every day task: `docs/specs/_days-common.md`. Branch: `day-03-hands-on-and-editor`.
Six panels are hands-on today (docs/handoffs/F-23.md): read `ui/src/showme/commands.ts` and how a gesture
becomes one command through `api.cli`.

## Build
1. **Seven more hands-on panels**, each gesture exactly one Redis command, shown as "ran:" with the reply, the
   same way the existing six do it: stream (`XADD` with one or two fields), JSON document (`JSON.SET` on a path,
   `JSON.NUMINCRBY`), login streak (`SETBIT` for a day), unique visitors (`PFADD`), places (`GEOADD` by
   clicking the map), Bloom filter (`BF.ADD` and a `BF.EXISTS` probe), time series (`TS.ADD` now). Build every
   command with the existing pure builders and add tests for the new ones (quoting included). The six
   remaining panels show derived or server-wide state and stay read-only: say why on the panel in one line.
   Hands-on stays behind the `interactive` prop, refuses `game:*`, and the nets gets practice keys for the new
   ones.
2. **Completion in the code editor for `redis`, `db` and `log`.** Learner files export one function that
   receives `{ redis, db, log }`. Typing `redis.` should offer the client's real methods with their signatures.
   The list must come from the installed library's own type definitions, not from a list written by hand.
   Recommended: a small script (`scripts/dev/gen-client-api.mjs`, run by hand, output committed as
   `ui/src/editor/client-api.generated.json` with the library version in it) that walks the type of the client
   the learner gets (read `packages/shared/src/learner/deps.ts`) with the TypeScript compiler API already in the
   workspace, and a Monaco completion provider in `ui/src/editor/` that offers those members after `redis.`,
   `redis.multi().`, `db.` and `log.`. Do not load Monaco's TypeScript worker and do not change how the editor
   worker is created (docs/handoffs/F-14.md). If you choose another route, it must keep the game offline and add
   no dependency. You may run the generator script once: it only reads type files.

## Files you own
`ui/src/showme/**`, `ui/src/screens/ShowMeGallery.tsx`, `ui/src/editor/**`, the completion wiring in
`ui/src/panels/MonacoEditor.tsx` and `ui/src/panels/EditorPanel.tsx`, `scripts/dev/gen-client-api.mjs`,
`engine/src/features/editor-types.ts` only if you need it, tests, `scripts/check/D-03.sh`,
`docs/handoffs/D-03.md`.

## How it will be verified later
The nets at `/showme` against a running stack, each new gesture once; the editor in a code level.
