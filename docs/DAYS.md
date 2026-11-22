# The ten-day plan: status and how to resume

Puneet asked on 2026-11-20 for the whole ten-day plan at once, as ten pull requests, built by Sonnet subagents.
Shortly after he asked for it to be **resumable** and, for now, **code only, with no local runs**: his Mac was
short on memory and disk. So every day below was written without being run.

**Where it stands (2026-11-22):** all ten days are on `main`. No pull request was ever opened: only the owner's
account may open one here and the `gh` login on this Mac is not that account, so Puneet chose to have the ten
branches merged and pushed directly instead. CI on `main` is green, and on the same day the merged code was run
end to end: started with the real `scripts/start` on the owner's Mac in a throwaway project, and checked day by
day on hosted arm64 runners (see "Verified on 2026-11-22").

## The git identity: decided on 2026-11-22
The decisions log in `BUILD.md` (2026-11-01) says this repository's own git identity is the GitHub no-reply
address. That setting lives in `.git/config`, and the fresh clone made on 2026-11-02 did not carry it. So the
commits made on 2026-11-19 and 2026-11-20 took the Mac's global git identity instead: 32 on `main` (`48d2cc3` to
`e706f0b`) and 58 on the ten day branches. Found on 2026-11-20, and the setting was put back the same day.

Asked whether to rewrite those 90 commits (a forced push of `main` and of the ten branches), Puneet chose on
2026-11-22 to **leave them as they are**. Do not rewrite them.

Before the first commit of any session, `git config user.email` must print the no-reply address (the worktrees
share the setting). A fresh clone loses it; put it back from history, never by typing it:
`git config user.name "$(git log -1 --format=%an v1.0.0-rc2)"` and
`git config user.email "$(git log -1 --format=%ae v1.0.0-rc2)"`.

## The days
| Day | Branch | Spec | What it is |
|---|---|---|---|
| D-01 | `day-01-front-door` | specs/D-01 | Contributor guide and policies; a machine verdict on every pull request |
| D-02 | `day-02-first-five-minutes` | specs/D-02 | Start page while the stack builds; reply choices in threads; commentary |
| D-03 | `day-03-hands-on-and-editor` | specs/D-03 | Seven more hands-on panels; code completion for the Redis client |
| D-04 | `day-04-the-phone` | specs/D-04 | The cricket app in a phone frame, with a request waterfall |
| D-05 | `day-05-level-studio` | specs/D-05 | Level studio and community levels |
| D-06 | `day-06-your-turn` | specs/D-06 | "Your turn", the wanted-commands board, credits. Built on D-05 |
| D-07 | `day-07-economy-league` | specs/D-07 | Code golf by pull request |
| D-08 | `day-08-arcade` | specs/D-08 | Arcade: Be the Redis, and a kit for more cabinets |
| D-09 | `day-09-match-day` | specs/D-09 | The incident deck and the seeded survival run |
| D-10 | `day-10-launch-kit` | specs/D-10 | Docs site, starter issues and launch posts as drafts |

Shared rules: `specs/_days-common.md`. Extension points that kept the branches apart: `engine/src/features/` and
`ui/src/features/` (each feature has its own file and turns itself on there).

## Status (the orchestrating session edits this table, nobody else)
| Day | Code | On `main` (merge commit) | Its own check, 2026-11-22 |
|---|---|---|---|
| D-01 | complete | `d0690ba` | passes in `ci.yml` |
| D-02 | complete | `cacbff6` | static and proxy parts pass on arm64; the full start ran on the Mac |
| D-03 | complete | `912c1f6` | passes on arm64 |
| D-04 | complete | `be30de1` | passes on arm64, live request included |
| D-05 | complete | `ceafa29` | passes on arm64 |
| D-06 | complete | `2932bde` | passes on arm64, once its own expected range was corrected |
| D-07 | complete | `2f68034` | passes on arm64 |
| D-08 | complete | `0d51877` | passes on arm64 |
| D-09 | complete | `28034f0` | passes on arm64 |
| D-10 | complete | `b3f0c42` | passes in `ci.yml` |

Every day's screens and routes also answered on the Mac run (see "Verified on 2026-11-22"). What nobody has done
yet is play each new feature by hand for feel: layout, sound, difficulty.

"Complete" means the day's handoff says "code complete and unverified". The handoffs are on `main` now:
`docs/handoffs/D-0n.md` (sections Status, Done, Remaining, How to verify).

**CI on `main`: green on `12bfc03` (2026-11-22), on the fifth run.** It builds every package (the UI with
`next build`), lints, checks the format, runs 1,219 unit tests (shared 239, UI 508, engine 295, runner 41, app
136), validates the campaign (still 8 chapters and 96 levels), runs the docker-free checks (D-01, D-10, G-03)
and builds the docs site. What the first four runs found is under "Merged on 2026-11-22" below.

CI does **not** build the Docker image, start the stack, open a screen or send one command to the game's own
Redis. So "green" says the code compiles and its unit tests hold, not that the game starts or that a day works.

## Verified on 2026-11-22
Puneet lifted the hold on local runs the same evening ("test here on this Mac"). `main` was `ae6e574`.

**On his Mac, in a throwaway project** (`quest_isolate`, own ports and volumes; his own game was never started):
- `scripts/start` as it is: preflight all PASS, the image built with the new pnpm download stage, every container
  healthy, the stage file ended at `ready`. 65 seconds with a warm network.
- `scripts/ci/stack-probe.mjs up` (on the `e2e/stack` branch): all 16 pages answer 200; 8 chapters, 96 levels; 16
  reply choices; a fresh game creates a player; the community pack loads; the board lists 288 commands, 100
  taught; all six League holes score their house entry at par; a shorter entry scores under par; the phone's
  traced request carries its trace and an ordinary one does not.
- In a browser: the map, a level screen and the eight new screens render with no console error.
- A copy of his real save (160 XP, 9 levels passed) loaded in the new engine and came back byte-identical.

**On hosted Linux arm64 runners** (pull request 1, branch `e2e/stack`, workflow `stack`): a fresh start with the
same probe, green; and the days' own check scripts: D-03, D-04 (with a live traced request), D-05, D-07, D-08
and D-09 pass. D-09 is the one that mattered most: a whole match and a stopped one, `maxmemory` lowered and put
back, every key outside `cache:*` unchanged, no undo journal left behind. D-02 passes its static part and the
proxy-alone part (the start page keeps the 502 status); its full-start part needs a Mac's preflight and was
covered by the run above. D-06 passes once its own expected range was corrected: it wanted 65 to 72 taught
commands, a count made without a Redis, and the server says 100 (the list was read and is right). D-01 and D-10
run in `ci.yml`.

**The older checks, there too.** Of the 22 P and C checks, 21 pass on every run, P0-10 among them (Chapter 0
played in Chromium). Three were wrong about themselves and are fixed: P0-12 (it looked for a CI line as it was
written before that day), P0-04 (it compared the seed as gzip bytes, which differ between machines; it compares
the SQL now) and D-06 (above). The twenty-second, C5, re-measures a disk benchmark for level 03 that passes on
one run and fails on the next on the runner's disk; that one proof is left to a Mac.

**The grader, and the question it raised.** With ops levels, on the merged code: 312 of 316 rows pass, twice.
The rows that do not are all rows that judge a time on the machine: the reference solutions of ch3-06 (and the
interview levels that reuse it) and ch4b-01 miss an absolute p99 limit (60 ms and 100 ms) under load, and once
ch4-15 counted its search index before it had filled. Was that the merge? The same grader on the code from
before the merge (`ecf3925`), on the same kind of runner: 310 pass, and it misses the same limits (ch3-06 at 403
ms, ch3-14 at 156 ms, ch4b-01) plus ch2-02 and ch4-15. **So it is the 4-CPU runner, not the merge.**

**And on the owner's Mac, on the merged code, later that evening:** `G01_RUN_OPS=1 scripts/check/G-01.sh`, in
its own project beside his running game: **316 PASS, 0 MISMATCH, 6 SKIPPED** in 20 minutes, the same totals as
the run of 2026-11-19 before the merge. The rows that miss their limit on the runner pass here. His game was
snapshotted before and after (container ids and start times, the save file's hash, Redis key counts and
`maxmemory`, Postgres row counts): nothing changed but one key's remaining time to live.

**`pr-verdict.yml` (D-01) ran to the end for the first time**, on pull request 1: 238 rows pass, none
mismatches, 62 are skipped by design (ops, traffic and random-pool levels).

**The owner then started his own game** (`./scripts/start`, 20:01 that evening): preflight clean, image from the
cache, every container up, his save loaded (160 XP, 9 levels passed, on ch1-05).

## Merged on 2026-11-22, without pull requests
One merge commit per day, in this order (least risky first), starting from `ecf3925`:
D-10, D-01 (documents and workflows), D-03, D-04, D-08 (screens), D-05 then D-06 (the level loader changes),
D-07, D-09 (they send commands to Redis), D-02 last (it changes how the game starts).

- Before the merge, all 45 pairs of branches and the whole chain were merged in memory (`git merge-tree`) with no
  conflict. No day changes a package manifest or the lockfile.
- One fix came with it (`cb87d77`): `ci.yml` and `pr-verdict.yml` passed every folder under `levels/` to the
  validator and the grader as a campaign chapter, which now would include `levels/community` (D-05). Both skip
  it, as the loader does.
- CI then found four problems before it went green:
  - D-06 (`f53f055`, formatted in `6db8dde`): **three engine source files had never been committed.** The root
    `.gitignore` rule `coverage/`, meant for test coverage reports, matched `engine/src/coverage/`, so git, the
    linter and the formatter all skipped it; the day's own type check passed because the files were on its disk.
    They were recovered from the day's worktree. The rule and the lint config now except that folder.
  - D-07 (`690c816`): the scorer test's sample hole could not be passed by any entry.
  - D-07 (`c1da20e`): the route test expected no tie where the attempt equals a committed entry.
  - D-08 (`12bfc03`): one note was a character too short for the arcade's own rule.

  The last three are test expectations that were wrong and had never run; no product code changed. Along the
  way (`a03082f`) CI's test step got `--no-bail`, so one run shows every package's failures.
- To take one day back out: `git revert -m 1 <its merge commit>` and push. D-06 is built on D-05, so D-06 goes
  first. Bringing a day back later means reverting that revert, not merging its branch again.
- The ten branches are still on GitHub, and their worktrees are in `~/personal-repo/Redis-Quest.worktrees/`.
  Nothing more is committed to them: work continues on `main`, one task and one commit at a time (`CLAUDE.md`).
  **The `day-06-your-turn` branch does not build on its own** (it lacks the three recovered files); `main` does.
  Checked after the recovery: the worktrees hold nothing else that git lacks (only D-10's generated site).
- Lesson: before a branch is called complete, list what git ignores in it
  (`git ls-files --others --ignored --exclude-standard`, minus `node_modules` and build output). A file can pass
  every local check and still not be in the repository.

## Four things that reach beyond their own screens
`main` is also the folder the owner's own game starts from. Each of these ran on an isolated stack on 2026-11-22
(above) and did what it says; they still act on the Redis they are pointed at, by design:
- **`scripts/start` itself (D-02)** brings the proxy up first, then builds, then starts the rest. If a start ever
  fails in a way it did not before, take D-02 out (`git revert -m 1 cacbff6`) and start again.
- **Match Day (D-09)** changes the running Redis on purpose and undoes it from a journal.
- **Scoring a League entry (D-07)** empties logical database 7, on a connection of its own. Opening `/league`
  scores the committed entries, so it does this too.
- **The studio's play-test (D-05)** writes a draft level's keys to the player's Redis, after checking that none
  of them exists.

A check of any of them still runs on an isolated stack (`scripts/check/lib/isolate.sh`; never a bare
`docker compose`).

## Per day: what it adds, and what is still owed
Written from the handoffs. Every block ends the same way: nothing in it has been run.

### D-01: the front door, and a machine verdict on every pull request
Adds:
- `CONTRIBUTING.md`, `CODE_OF_CONDUCT.md`, `SECURITY.md`, a pull request template and two issue templates.
- `.github/workflows/pr-verdict.yml`: on every pull request it builds the engine, app and runner, starts them as
  plain processes (`scripts/ci/stack.mjs`), grades the cli, code and decision levels and writes the table into the
  job summary. Read-only token, no secrets, no `pull_request_target`.
- `scripts/review-pr <n>`: the maintainer's own review of a pull request in a temporary worktree. It refuses a
  pull request that changes scripts, workflows, Docker files or package manifests unless told the diff was read.

Still owed:
- The verdict workflow first ran to the end on pull request 1 (2026-11-22): 238 rows pass, none mismatches, 62
  are skipped. It has not yet judged a pull request that changes a level, which is what it is for.
- It skips ops levels, outage and profile events, random interview pools, and every level with a traffic check.
- `scripts/check/D-01.sh` is marked docker-free, so the `fast` job in `ci.yml` runs it on every push.
- `.github/workflows/README.md` should gain a `pr-verdict` section.
- Owner, after the first green run: the maintainer checklist at the end of the handoff.

### D-02: the first five minutes
Adds:
- A start page while the stack builds (`docker/starting/index.html`), served by the proxy until the UI answers,
  fed by a stage file that `scripts/start` writes.
- Reply choices in the chapter threads: 16 of the player's own lines offer two or three ways to say it. The first
  choice is the line as it was, so nothing changes for a player who skips.
- Commentary lines (Hinglish, English or off) on the verdict screen, the dangerous-command toast, and Redis going
  down and coming back.

Still owed:
- **The riskiest of the ten: it changes how the game starts.** `scripts/start` brings the proxy up first, then
  builds, then starts the rest; `docker/Caddyfile` gains a `handle_errors` block; `docker-compose.yml` gains a
  proxy volume. It needs `caddy validate` and the isolated start test in `scripts/check/D-02.sh` (parts B and C).
- Unchecked: that the start page keeps the 502 status. If it answers 200, the page reloads forever and every
  `curl` check sees a game that is up.
- `GET /api/chapters` now carries `choices` on player messages.
- Not wired (the files belonged to other tasks while the days were apart): a line when a chapter's last level
  passes, a line when the whole stack goes down, and `scripts/stop` removing the stage file.
- The Hinglish lines were read by nobody but the agent that wrote them.

### D-03: seven more hands-on panels, and completion for the Redis client
Adds:
- Hands-on versions of seven show-me panels (stream, JSON, bitmap, HyperLogLog, geo, Bloom filter, time series).
  Each shows the command it will run, then the command it ran. 13 of the 19 panels are now hands-on, and the six
  that stay read-only say why.
- Completion in the editor for the learner's Redis client, from a member list generated out of the installed
  `redis` package (`scripts/dev/gen-client-api.mjs`).

Still owed:
- **Redis facts not verified** (the digest only names these commands): the reply of `SETBIT`; `BF.ADD` and
  `BF.EXISTS` and their replies; the replies of `TS.ADD` and `PFADD`; `GEOADD`'s coordinate limits; `BF.ADD`
  creating a missing filter. Check them against the server or the official docs, then fix or label.
- Nobody has opened a panel or the completion in a browser, and the growth of the bundle from the editor's
  suggest widget was not measured.
- `scripts/check/D-03.sh` is not marked docker-free yet: mark it once it has run.

### D-04: the phone
Adds:
- `/phone`, and a Phone tab in the level workbench: the cricket app in a phone frame, four read-only screens
  (player stats, fixtures, leaderboard, ticker), Refresh and Refresh 20 times.
- A request trace: when the UI asks with the header `x-quest-trace: 1`, the app answers with what that request
  did (each Redis and Postgres call, whose code made it, how long it took). The UI draws it as a waterfall and a
  spread of timings. Without the header nothing is built and nothing is slower.

Still owed:
- Unchecked: that the proxy passes the `x-quest-trace` header both ways, and that the ticker's match (`m-041`)
  exists in the seed.
- `deps.redisCached` is not traced, so a cache hit shows no Redis bar.
- The trace wraps the counted client inside `app/` and not in the shared package (it was not this task's file).

### D-05: the level studio and community levels
Adds:
- `/studio`: write a level in a form, see it validated by the engine's own validator as you type, preview it with
  the real components, play-test it against your Redis, and get the files as a zip with the git commands to send.
- Community levels: `levels/community/<pack>/`, their own loader and rules, `/community` and a level screen, one
  sample level by the house, `scripts/level-new`, and an optional `author` on a level.

Still owed:
- It changes the campaign loader, which now skips a directory named `community`. CI's validator still counts 8
  chapters and 96 levels; the grader's totals (316 rows at the last full run) are not confirmed.
- A community level is `cli` or `decision` only, and its screen has no interview, slots, traffic or show-me panel.
- Nobody has opened the screens: expect layout fixes.

### D-06: your turn, the wanted-commands board, the credits
Built on D-05.

Adds:
- `/your-turn`: three steps that tick themselves. Pick a command no level teaches, play-test a level about it in
  the studio, open the pull request.
- The wanted-commands board (`GET /api/coverage`): every command the server lists, set against what the levels
  teach.
- `/credits`: the cast, the authors of community levels, `CONTRIBUTORS.md` (new), and the player's own line.

Still owed:
- `engine/src/coverage/` (the board, the usage reader, the contributors parser) reached git only on 2026-11-22,
  from the day's worktree. Its unit tests pass in CI; nobody has seen the board with a real server's command list.
- The engine image now copies `fiction/cast.json` and `CONTRIBUTORS.md` (never built).
- The handoff's count of taught commands (about 68) was made without a Redis: compare it with a real server.
- Two wishes outside its own files: the map card should read as the next thing after the Finale (the logic is
  ready in `ui/src/features/yourturn/logic.ts`), and the studio should read `?command=<name>`.

### D-07: the Economy League
Adds:
- Code golf by pull request: `golf/` holds six holes, each with a par and a house entry. An entry is a `.redis`
  file. Lowest score wins: fewest commands, then fewest bytes in the checked keys, then fewest characters.
- `.github/workflows/league.yml` scores entries on pull requests that touch `golf/**`; `scripts/league/score.mjs`
  does the same by hand.
- `/league` in the game: read a hole, write an entry, score it against your own Redis, see the scorecard.

Still owed:
- **Every par, every house entry and every "this can be beaten" note is unproven**: nothing ran against a Redis.
- Scoring empties and uses logical database 7 on a connection of its own, and refuses to run unless the server
  says it is on database 7. A cluster is refused. The Redis behaviour this relies on (`CLIENT INFO` reporting the
  database, the replies of `MEMORY USAGE`) is not in the digest: not verified.
- The engine image now copies `golf/` (never built).

### D-08: the arcade and its first cabinet, "Be the Redis"
Adds:
- `/arcade`, and a kit for building cabinets (seeded random, a fixed-step clock, best scores, a frame, a list
  where every rule names its source), with `docs/arcade.md` on adding one in a single folder.
- The first cabinet, "Be the Redis": commands arrive on a belt and you serve them one at a time. The words on a
  card are the server's own; how long a command takes is the game's model, and the cabinet says so.

Still owed:
- It has never been drawn on a screen or played: layout, keys, sound and difficulty are guesses.
- Seven commands whose live text nobody had seen (`hget`, `incr`, `hgetall`, `smembers`, `lrange`, `hscan`,
  `sscan`) were checked on 2026-11-20 against the official command files in redis/redis: the cost class the game
  assumes for each holds. This stack's own replies are still unseen.
- The rule "one command at a time" is drawn from four digest lines; "500 items per call" for `SCAN` is the game's
  number and is labelled so.
- The tests in `ui/test` are not covered by the type check.

### D-09: Match Day
Adds:
- A survival run with a seed: a fixture for that seed, a deck of five incidents (`incidents/*.yaml`) that change
  Redis in the middle of the match and are undone afterwards, a war room with live numbers, a scorecard and a
  results file.
- `/matchday` in the game, and routes under `/api/matchday`, with `POST /api/matchday/stop` as the way out.

Still owed:
- **It changes a running Redis on purpose and relies on an undo journal that has never run.** Prove the undo on
  an isolated stack before it goes near a real save.
- The budgets are chosen, not measured: 1% errors, 400 ms p99, 800 ms in an over with an incident.
- It refuses Sentinel and cluster targets. The routes are not behind a player check.
- The engine image now copies `incidents/` (never built).

### D-10: the launch kit
Adds:
- A docs site generator (`scripts/site/build.mjs`): home, a catalogue of the 96 levels, a commands index, a page
  on grading and a page on contributing. `.github/workflows/pages.yml` builds it on every push to `main` and
  publishes only when the repository variable `PAGES_ENABLED` is `true` (Pages is off on this repository).
- Twenty starter issues as drafts (`docs/launch/issues/`) and a script that files them
  (`scripts/launch/create-issues.sh`, with `--dry-run`).
- Launch posts as drafts (`docs/launch/posts/`), each claim mapped to the file or command that proves it, and
  `docs/launch/CHECKLIST.md`.
- README corrections outside the contributing section.

Still owed:
- Owner first: the name question (the checklist links Redis's trademark policy and does not interpret it), and
  the `[OWNER ...]`, `[SITE URL ...]` and `[LINK ...]` brackets in the posts.
- Never run: the issues script (not even its dry run) and `scripts/launch/facts.mjs`. The site generator ran once
  and its output was read as text only.
- `scripts/check/D-10.sh` is marked docker-free, so CI runs it on every push.

## How to resume
1. The git identity is decided (above): rewrite nothing. Check `git config user.email` before the first commit.
2. Everything is on `main`. Read CI there first: it builds, lints, tests and validates the levels on every push,
   and it costs this Mac nothing. Fix what it reports, on `main`.
3. For a day, read its handoff (`docs/handoffs/D-0n.md`) and its "Still owed" list above.
4. Verification, when the Mac has room and Puneet says so (local testing is on hold): `pnpm install
   --frozen-lockfile`, `pnpm -r build`, `pnpm -r lint`, `pnpm -r test` against an isolated Redis and Postgres,
   each day's `scripts/check/D-0n.sh`, then the "How to verify" section of its handoff. Never a bare
   `docker compose`: the default project is the owner's game (`scripts/check/lib/isolate.sh`).
5. A day that turns out broken and is not quickly fixed: take it out with `git revert -m 1 <its merge commit>`.
6. The worktrees in `~/personal-repo/Redis-Quest.worktrees/` are no longer needed for work. Remove one with
   `git worktree remove <path>` when the disk is wanted; its branch stays.

## Also parked
- The tag `v1.1.0-rc1`: the tester guide and invite still name `v1.0.0-rc2`. It needs a fresh-clone start test
  first (clone, own ports in `.env`, `COMPOSE_PROJECT_NAME=quest-fresh`, `./scripts/start`, the first-run flow in
  a browser, `down -v`). One attempt stalled in preflight on 2026-11-19 and was never explained.
