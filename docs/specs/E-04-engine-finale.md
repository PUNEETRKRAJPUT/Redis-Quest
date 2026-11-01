# E-04: engine, schema, UI and harness pieces the Finale needs

**Goal.** The Finale's mock interview draws its use case at random from the earlier rebuilds, starts from a
blank file, grades with the drawn level's own verifiers, and asks follow-up questions after. The last level
writes a portfolio page from the learner's own save and workspace. Verdict records must keep the numbers that
page quotes.

**Depends on.** nothing.

**Files owned.**
- `packages/shared/src/levels/` (schema: the `interview.pool` form; loader: pool reference checks; README-facing
  types), `packages/shared/src/levels/__tests__/`
- `engine/src/` except `engine/src/verify/slots.ts`; `engine/test/`
- `ui/src/`, `ui/test/`
- `scripts/grade/grade.mjs`, `docs/grading.md`, `levels/README.md` (field tables and one section)
- `scripts/check/E-04.sh`, `.env.e04` (gitignored: `PROXY_PORT=3600 REDIS_PORT=6396 PG_PORT=5438 INSIGHT_PORT=5546 ENGINE_DEV=1`)
- `docs/handoffs/E-04.md`

**Must not touch.** `app/`, `runner/`, `packages/shared/src/learner/`, `engine/src/verify/slots.ts`, `levels/`
(apart from `levels/README.md`), `scenarios/`, `docker-compose.yml`, `docker/`, other checks, `docs/BUILD.md`.
Compose project `quest-e04` only.

**Interfaces to honour.** `docs/handoffs/F-12.md` (interview levels: `interview { minutes, rebuild_of,
hint_xp_cost }`, progress fields, `GET /api/levels/:id` `interview` block, the countdown), `docs/handoffs/E-01.md`
(switch, events), `engine/src/verify/index.ts` (`levelSlots`, how a level's verify specs and fixtures resolve
through its `LoadedLevel`), `engine/src/workspace.ts` (`writeWorkspaceFile`, `listTree`), `engine/src/progress.ts`
(verdict records), `docs/handoffs/G-01.md` and `docs/grading.md` (how the harness plays an interview level:
solutions by path from the level it rebuilds).

**Work.**

1. **Interview pools (schema + loader).** `interview` gains an alternative to `rebuild_of`:
   ```yaml
   interview:
     minutes: 20
     hint_xp_cost: 20
     pool:
       - rebuild_of: ch2-02-cache-aside-v1
         questions:            # follow-up fire: quiz verifiers in the interviewer's voice, asked after the rebuild's own checks
           - type: quiz
             question: "..."
             options: [...]
             correct: ...
             explanation: "..."
       - rebuild_of: ch3-03-token-bucket
         questions: [...]
   ```
   Exactly one of `rebuild_of` / `pool` (pool with 2 to 12 entries, each `rebuild_of` unique, 1 to 5 questions
   each, quiz option ids unique within the pool entry). A pool level is a `code` level whose own `verify` list
   must be **empty or absent** (its checks come from the draw) and whose `solutions` block is **absent** (the
   draw's level has them); relax the "a code level needs a behavior or traffic verifier" and the `solutions`
   requirement for pool levels only. `rebuild_of` targets must be earlier levels, as F-12 checks. New field on
   `interview`: `blank_start: true | false` (default `true` for pool levels, `false` for `rebuild_of` levels, to
   keep Chapters 2 to 4 as they are).
2. **The draw (engine).** On `POST /api/levels/:id/start` of a pool level, if the player has no draw for it yet,
   pick one entry: seeded by `player.id + level id` (stable across restarts), excluding `rebuild_of` targets already
   drawn by this player in other pool levels (so three finale levels give three different use cases; when every
   entry is excluded, allow repeats). Store `drawn: <rebuild_of>` on the level's progress entry; the first start
   wins (like the clock). `blank_start`: for each slot file of the drawn level (`levelSlots` of its verify, mapped
   through the slot table), if the workspace file exists and is non-empty, rename it to
   `<file>.before-<pool level id>` (never overwrite an existing backup: add `-2`, `-3`) and write an empty file;
   record `blanked: [{ file, backup }]` on the progress entry; the level payload lists them so the UI can say
   "your earlier file is at ...". A re-start never blanks again.
   `GET /api/levels/:id` for a pool level: `story`, `brainstorm`, `hints`, `reward`, `title` from the pool level;
   `task`, `show_me`, `docs`, `scenario`, `minRedisVersion` from the drawn level; `verifiers` = the drawn level's
   public verifiers followed by the pool entry's questions; `interview.rebuildOf` = the drawn level; new
   `interview.drawn: { id, title, chapter }` and `interview.blanked`. Before the first start (locked/available)
   the payload says `interview.drawn: null` and the task reads "The interviewer picks when you start."
   `POST /api/levels/:id/verify`: run the drawn level's verify specs **as that level** (its fixtures resolve from
   its directory, its slots, its scenario), then the pool entry's quizzes with answer indices continuing after
   the drawn specs; verdict rules unchanged. Hints: the pool level's own hints (write them pattern-agnostic in
   content) plus the drawn level's hints appended, all at the pool's XP cost. "Ideal way" links to the drawn level.
   `levelSlots` for the slot switch and the traffic verifier come from the drawn level.
3. **Verdict metrics in progress (additive).** The stored verdict record gains `metrics?: { p99Ms, baselineP99Ms,
   dbPerRequest, baselineDbPerRequest, redisPerRequest, hitRatio, rps }` (whichever the traffic check produced) and
   `elapsedMs` for interview levels, so the portfolio can quote "p99 4,100 ms to 11 ms" from the save alone.
4. **Portfolio.** `GET /api/portfolio` → `{ markdown, stats }` built from the progress file, the level files and
   the workspace: title with the player's name, XP and badges; per chapter the passed levels with one line each
   (title; for traffic levels the before/after numbers from the stored metrics; for interview levels "rebuilt in
   m:ss"; for pool levels the drawn use case), the learner's brainstorm lines (option label + their text) as
   "how I thought about it", the workspace tree (files under `workspace/` with sizes, excluding backups and
   `_bundle-*` shims), and a closing section "what I would say in an interview" assembled from the levels' own
   titles (no invented claims: every number comes from the save, every sentence names its level).
   `POST /api/portfolio/write` writes it to `workspace/PORTFOLIO.md` (through `writeWorkspaceFile`), answers
   `{ path, bytes, levels }` and emits `level.event custom portfolio_written { bytes, levels, passed }`.
   UI: on "What you built", a button "Write my story" (`data-testid="write-portfolio"`) that calls the route and
   shows the markdown rendered (reuse the markdown renderer) with the path; unit test.
5. **Harness.** Pool levels: after `start`, read `GET /api/levels/:id`, take `interview.drawn.id`, and grade with
   **that** level's solutions (resolve paths from the drawn level's directory; bundle rules as for any multi-slot
   level), feeding the pool entry's quizzes correct for good solutions and one wrong for wrong ones; print the
   draw in the row note. `portfolio_written`: for good solutions, POST `/api/portfolio/write` before verify.
   Document both in `docs/grading.md`. `levels:validate` must accept pool levels (and reject a pool whose
   `rebuild_of` is not earlier, a pool level with `verify` or `solutions`, and `rebuild_of` together with `pool`).
6. **README.** The `interview.pool` form, `blank_start`, the portfolio route, the new event.

**Acceptance check.** `scripts/check/E-04.sh` (bash 3.2, project `quest-e04`, scratch levels: `example-code`
plus a scratch chapter `scratch-e04` with (a) a pool level over `example-code-01-cache-aside` and
`example-code-02-token-bucket` with one follow-up quiz each, (b) a second pool level over the same two (the draw
must differ from the first), (c) an ops level with `event custom portfolio_written` and a `.redis` reference
`PING`; scratch progress and workspace; `down -v` on exit):
- shared, engine and ui vitest; lints; format; `levels:validate` accepts the scratch chapter and rejects the three
  bad shapes (a temp dir each);
- a pre-existing non-empty `workspace/ch2/cache.js` is moved to `cache.js.before-<id>` on the first start of (a) and
  an empty file is in its place; a second start does not move the backup again; the level payload lists it;
- `GET /api/levels/<a>` shows `interview.drawn`, the drawn task and verifiers plus the follow-up quiz; (b) draws the
  other entry; the draw survives an engine restart;
- the harness grades (a) and (b): the drawn level's reference `right`, its wrong `wrong`, with the draw in the note;
- `GET /api/portfolio` after those passes contains the player's name, the drawn levels' titles, a before/after p99
  line for the cache-aside level (from stored metrics), and the workspace tree; `POST /api/portfolio/write` writes
  `workspace/PORTFOLIO.md` and emits the event; the harness grades (c) `right`;
- `example-code` grades with no MISMATCH (regression: `rebuild_of` levels and the stored metrics change nothing);
- exit 0, print each thing verified.

**Handoff complete when.** the check passes; `docs/handoffs/E-04.md` has the schema as built, the draw rule, the
level payload for pool levels, the progress fields, the portfolio format (a sample), the harness rules, and the
check output.

**Model.** sonnet
