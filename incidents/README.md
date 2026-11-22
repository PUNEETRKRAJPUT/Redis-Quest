# incidents/

The incident deck for Match Day (`/matchday`, spec `docs/specs/D-09-match-day.md`). A card is something that goes
wrong during one over of the match. The schema and loader are `packages/shared/src/matchday/deck.ts`; this page is
the contributor's view. A bad card is reported by the loader and left out of the deck, it never stops the engine.

## A card (`incidents/<id>.yaml`, the file name is the id)

```yaml
id: cache-wiped                     # kebab-case, equal to the file name
title: "The groundsman sweeps the cache"   # at most 80 characters
sees: |                             # what the player sees: the symptom, in the match's voice
  ...
cause:
  summary: |                        # how the engine causes it, in plain words
    ...
  steps:                            # 1 to 4 steps, each kind at most once
    - kind: delete_keys
      prefixes: ["cache:player:"]
ends: |                             # how it ends, and what is put back
  ...
facts:                              # every claim the card makes about Redis
  - text: "..."
    source: digest                  # digest | measured | simulation
    ref: "https://redis.io/docs/latest/..."   # required for digest
```

## What a card may do (the only four things)

| kind | fields | what the engine does | how it is undone |
|---|---|---|---|
| `switch_scenario` | `scenario` (an id in `scenarios/`) | runs the over with that scenario instead of the over's own | nothing to undo: the next over has its own scenario |
| `delete_keys` | `prefixes` (1 to 3) | SCAN with MATCH `<prefix>*` and DEL, once, before the over | **not undone**: only cache keys can be named, and the player's own code rebuilds them |
| `lower_maxmemory` | `headroomKb` (64 to 8192) | `CONFIG SET maxmemory <used_memory + headroom>` for the over; only when `maxmemory-policy` is `noeviction` | the value read beforehand is journaled to a file and set back after the over, at the end of the match, and on the next connect if the engine was cut off |
| `block_script` | `iterations` (1 to 200 million), `startAfterSec` (0 to 8) | one bounded counting loop in Lua, no keys, no writes, started that many seconds into the over | it ends by itself; the engine waits for it before scoring |

Rules the loader and the engine both enforce:

- `delete_keys` prefixes start with `cache:`, name something after it, contain no `* ? [ ] \`, and never touch `game:*`
  (the engine's own keys) or anything that could match it.
- A card cannot run a command that is not in the table. There is no card that flushes a database, kills a script
  or changes the Redis target.
- Every change is undone when the match ends, however it ends (finished, all out, stopped, an error, the engine
  restarting).

## Facts

Anything a card says about Redis has to be true and checkable. Give each claim a `source`:

- `digest`: it is in `docs/redis-docs-digest.md`; `ref` is the page it comes from.
- `measured`: observed on this stack; say what was observed.
- `simulation`: how the game stages the incident (sizes, headroom, durations chosen by the game).

Never state a Redis behaviour from memory. If it is not in the digest, label it `measured` or `simulation`, or leave it out.

## Adding a card

1. Copy a card, change the id and the file name together.
2. Use only the four steps above. A new kind of step is an engine change (`engine/src/matchday/`), not a YAML change.
3. `pnpm --filter @quest/shared test` runs the deck test, which loads every card in this folder.
4. The match picks cards by seed, so adding a card changes the fixture of every date after it ships.
