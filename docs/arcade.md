# The arcade: how to add a cabinet

A cabinet is a one-minute game that makes the player *be* a part of Redis, because some things are easier to feel
than to read. The first one is **Be the Redis** (`/arcade`): you run the commands of a line of clients one at a
time and learn that one slow command delays everyone behind it. The next announced one is "Be the eviction
policy". Yours can be a third.

A cabinet is one folder. Nothing outside it needs editing except one line in a list.

## 1. The folder

```
ui/src/features/arcade/cabinets/<your-id>/
  meta.ts        id, title, pitch, lesson, facts, keys   (what the arcade page and the frame show)
  facts.ts       every rule of the game and where it comes from
  logic.ts       the whole game as pure functions (no React, no clock, no storage)
  <Name>.tsx     the screen: a <CabinetFrame> around your game
  index.ts       export const yourCabinet: Cabinet = { ...META, Component: Name }
```

Then add it to the list in `ui/src/features/arcade/cabinets/registry.ts` (`CABINETS`). The arcade page shows it as
a machine with its best score. Remove it from `COMING` if it was announced there.

## 2. What the kit gives you (`ui/src/features/arcade/kit/`)

| Piece | What it is |
|---|---|
| `types.ts` | `Cabinet`, `CabinetFact`, `FactSource`, `KeyHelp` |
| `Frame.tsx` | `CabinetFrame`: title, scores, pause, restart, the "what this teaches" panel with every rule's source, the keyboard help, a polite live region. Your game goes in its children. |
| `random.ts` | A seeded random source (mulberry32). The state is a number you keep in your own game state, so a run can be replayed from its seed. `freshSeed()` also honours `?seed=123` in the address. |
| `loop.ts`, `useFixedLoop.ts` | A fixed-step clock: the game advances in equal steps whatever the frame rate. A hidden tab or a stall never fast-forwards the game. |
| `best.ts` | Best score per cabinet in `localStorage` (`rq:arcade:best:<id>`). Blocked or missing storage is handled. |

## 3. The rules of a cabinet

1. **Never invent a Redis fact.** Every rule the game shows is a `CabinetFact` with exactly one source:
   - `digest`: lines of `docs/redis-docs-digest.md`, each with a word that must be on that line. A test reads the
     digest and checks every line you cite (copy `ui/test/arcadeFacts.test.ts`). If the digest does not say it, say
     what it does not say in `note`.
   - `server`: the server's own `COMMAND DOCS`, which the engine serves (`GET /api/command-docs`, `docs/handoffs/E-06.md`).
     Read it with the terminal's reader (`ui/src/terminal/docs.ts`, `useDocs.ts`), never with a second one, and never
     through `POST /api/cli` (`docs/handoffs/F-22.md` says why). Have a verbatim fallback for when the stack is down
     and say on screen which one is showing.
   - `simplification`: the game's own rule, with what is simplified in words a player can read.
2. **A model is not a measurement.** If the game makes up numbers (ticks, sizes, patience), the cabinet says it is a
   simulation, on the screen, in plain words.
3. **One true thing.** The `lesson` is one sentence. After the round, say what happened in two sentences and the one
   idea to take away.
4. **Fun in ten seconds, done in about a minute.** Clear cards, one obvious action, visible consequences, a score, a
   restart.
5. **Keyboard playable.** Space is the main action. Do not take Space or Enter from a focused button (see
   `BeTheRedis.tsx`). Under reduced motion nothing slides: things step.
6. **Design system only.** Primitives, tokens and `play()` cues from `@/design`; `data-ds=""` on roots; lucide icons,
   no emoji; visible focus. No canvas library, no game engine, no new dependency, nothing leaves the origin.
7. **Reserved keys.** `game:*` belongs to the engine. A cabinet never touches Redis at all: it simulates.

## 4. Tests

Put the game in pure functions and test them in `ui/test/` (`vitest`, node environment, no DOM). A good set: the
seeded source gives the same round twice; the cost or scoring rules on hand-built states; the end of the round; the
debrief text; every digest line cited by `facts.ts`; and a static render of the screen (`renderToStaticMarkup`) for
the title, the lesson and the simulation note.

## 5. Check list before a pull request

- `pnpm --filter @quest/ui exec tsc --noEmit`, `pnpm --filter @quest/ui lint`, `pnpm --filter @quest/ui test`.
- `pnpm exec prettier --check` on your files.
- Play it once with sound on and once with reduced motion on, at 1280 and at 1024 wide.
