# The ten-day plan: status and how to resume

Puneet asked on 2026-11-20 for the whole ten-day plan at once, as ten pull requests, built by Sonnet subagents.
Shortly after he asked for it to be **resumable** and, for now, **code and parked pull requests only, with no
local runs**: his Mac was short on memory and disk. So every branch below is written without being run. Nothing
here is verified beyond a type check and a lint.

**Where it stands (2026-11-20):** all ten branches are written and pushed. No pull request is open, and none
should be opened before the decision in the next section.

## Decide before any pull request is opened: 90 commits carry the wrong git identity
The decisions log in `BUILD.md` (2026-11-01) says this repository's own git identity is the GitHub no-reply
address. That setting lives in `.git/config`, and the fresh clone made on 2026-11-02 did not carry it. So every
commit made since 2026-11-19 took the Mac's global git identity instead: 32 commits on `main` (`48d2cc3` to
`e706f0b`) and 58 on the ten day branches. Found on 2026-11-20 while preparing the pull requests, and the setting
was put back the same day, so new commits are right again. The other address is in commit metadata only, in no
tracked file.

No tag, no fork and no pull request holds any of those 90 commits, so this is the cheapest moment to rewrite
them. Rewriting means a forced push of `main` and of the ten branches, which is Puneet's call.

- Until he decides, **open no pull request**. GitHub's guide on removing sensitive data says a pull request keeps
  rewritten commits reachable, and that only GitHub Support can remove them.
- Before the first commit of any session, `git config user.email` must print the no-reply address (the worktrees
  share the setting). A fresh clone loses it; put it back from history, never by typing it:
  `git config user.name "$(git log -1 --format=%an v1.0.0-rc2)"` and
  `git config user.email "$(git log -1 --format=%ae v1.0.0-rc2)"`.
- If he says rewrite: change author and committer on those 90 commits and nothing else (one pass over `main` and
  the ten branches), force-push all eleven, then `git reset --hard origin/<branch>` in each worktree. Commit ids
  change from `48d2cc3` onward; no tag moves. GitHub can keep the old commits reachable by id for a while.
- If he says leave it: nothing more to do, and the pull requests can be opened.

## The days
| Day | Branch | Spec | What it is |
|---|---|---|---|
| D-01 | `day-01-front-door` | specs/D-01 | Contributor guide and policies; a machine verdict on every pull request |
| D-02 | `day-02-first-five-minutes` | specs/D-02 | Start page while the stack builds; reply choices in threads; commentary |
| D-03 | `day-03-hands-on-and-editor` | specs/D-03 | Seven more hands-on panels; code completion for the Redis client |
| D-04 | `day-04-the-phone` | specs/D-04 | The cricket app in a phone frame, with a request waterfall |
| D-05 | `day-05-level-studio` | specs/D-05 | Level studio and community levels |
| D-06 | `day-06-your-turn` | specs/D-06 | "Your turn", the wanted-commands board, credits. **Stacked on D-05** |
| D-07 | `day-07-economy-league` | specs/D-07 | Code golf by pull request |
| D-08 | `day-08-arcade` | specs/D-08 | Arcade: Be the Redis, and a kit for more cabinets |
| D-09 | `day-09-match-day` | specs/D-09 | The incident deck and the seeded survival run |
| D-10 | `day-10-launch-kit` | specs/D-10 | Docs site, starter issues and launch posts as drafts |

All branches start from the commit that added this file. Shared rules: `specs/_days-common.md`.
Extension points that keep the branches apart: `engine/src/features/` and `ui/src/features/` (each feature has
its own file and turns itself on there).

## Status (the orchestrating session edits this table, nobody else)
| Day | Code | Pushed | Pull request | CI | Run on a Mac |
|---|---|---|---|---|---|
| D-01 | complete | yes | not opened | none yet | no |
| D-02 | complete | yes | not opened | none yet | no |
| D-03 | complete | yes | not opened | none yet | no |
| D-04 | complete | yes | not opened | none yet | no |
| D-05 | complete | yes | not opened | none yet | no |
| D-06 | complete | yes | not opened | none yet | no |
| D-07 | complete | yes | not opened | none yet | no |
| D-08 | complete | yes | not opened | none yet | no |
| D-09 | complete | yes | not opened | none yet | no |
| D-10 | complete | yes | not opened | none yet | no |

"Complete" means the handoff on the branch says "code complete and unverified". `ci.yml` runs on pull requests
and on `main` only, so no day branch has had a CI run: opening its pull request starts the first one.

The truth for a day is its branch on GitHub and `docs/handoffs/D-0n.md` on that branch (sections Status, Done,
Remaining). If this table and a branch disagree, the branch is right.

Changes the orchestrating session made on the branches after the agents finished (2026-11-20, none built):
the engine image copies what D-06, D-07 and D-09 read at run time (`docker/node.Dockerfile`); D-09's export in
`packages/shared/src/index.ts` moved up so it no longer collides with D-07's; a note in D-08's handoff.

## Do the ten fit together
Tested on 2026-11-20 with `git merge-tree`, which merges content in memory and builds nothing:
- all 45 pairs of branches merge without a conflict, and all ten merge onto `main` in day order;
- the names D-07 and D-09 add to the shared package collide neither with each other nor with what is there.

Not tested: whether the merged tree type-checks, builds or runs. A pull request's CI covers its own branch only.

A sensible order, least risky first: D-10 and D-01 (documents and workflows), D-03, D-04 and D-08 (screens),
D-05 then D-06 (the level loader changes), D-07 and D-09 (they send commands to Redis), D-02 last (it changes how
the game starts).

## Opening the pull requests
None is open. Open each as a **draft**. The title is the day's heading below; the text is the block under it.

| Day | Into | Link |
|---|---|---|
| D-01 | `main` | https://github.com/PUNEETRKRAJPUT/Redis-Quest/compare/main...day-01-front-door?quick_pull=1 |
| D-02 | `main` | https://github.com/PUNEETRKRAJPUT/Redis-Quest/compare/main...day-02-first-five-minutes?quick_pull=1 |
| D-03 | `main` | https://github.com/PUNEETRKRAJPUT/Redis-Quest/compare/main...day-03-hands-on-and-editor?quick_pull=1 |
| D-04 | `main` | https://github.com/PUNEETRKRAJPUT/Redis-Quest/compare/main...day-04-the-phone?quick_pull=1 |
| D-05 | `main` | https://github.com/PUNEETRKRAJPUT/Redis-Quest/compare/main...day-05-level-studio?quick_pull=1 |
| D-06 | `day-05-level-studio` | https://github.com/PUNEETRKRAJPUT/Redis-Quest/compare/day-05-level-studio...day-06-your-turn?quick_pull=1 |
| D-07 | `main` | https://github.com/PUNEETRKRAJPUT/Redis-Quest/compare/main...day-07-economy-league?quick_pull=1 |
| D-08 | `main` | https://github.com/PUNEETRKRAJPUT/Redis-Quest/compare/main...day-08-arcade?quick_pull=1 |
| D-09 | `main` | https://github.com/PUNEETRKRAJPUT/Redis-Quest/compare/main...day-09-match-day?quick_pull=1 |
| D-10 | `main` | https://github.com/PUNEETRKRAJPUT/Redis-Quest/compare/main...day-10-launch-kit?quick_pull=1 |

`gh` on this Mac is logged in as a second account of his, not the one that owns this repository. It can read the
repository and should be able to open these pull requests (not tried); they would then show that account as
their author. Only on Puneet's say-so.

## Per day: what it adds, and what must happen before it merges
Written from the handoffs on the branches. Every block ends the same way: nothing in it has been run.

### D-01: the front door, and a machine verdict on every pull request
Adds:
- `CONTRIBUTING.md`, `CODE_OF_CONDUCT.md`, `SECURITY.md`, a pull request template and two issue templates.
- `.github/workflows/pr-verdict.yml`: on every pull request it builds the engine, app and runner, starts them as
  plain processes (`scripts/ci/stack.mjs`), grades the cli, code and decision levels and writes the table into the
  job summary. Read-only token, no secrets, no `pull_request_target`.
- `scripts/review-pr <n>`: the maintainer's own review of a pull request in a temporary worktree. It refuses a
  pull request that changes scripts, workflows, Docker files or package manifests unless told the diff was read.

Before it merges:
- The workflow has never run: its first run is this pull request. Rows that fail there may be the runner (amd64,
  a bare `redis:8`) and not the content.
- It skips ops levels, outage and profile events, random interview pools, and every level with a traffic check.
- `scripts/check/D-01.sh` is marked docker-free, so the `fast` job in `ci.yml` runs it on this pull request.
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

Before it merges:
- **The riskiest of the ten: it changes how the game starts.** `scripts/start` brings the proxy up first, then
  builds, then starts the rest; `docker/Caddyfile` gains a `handle_errors` block; `docker-compose.yml` gains a
  proxy volume. It needs `caddy validate` and the isolated start test in `scripts/check/D-02.sh` (parts B and C).
- Unchecked: that the start page keeps the 502 status. If it answers 200, the page reloads forever and every
  `curl` check sees a game that is up.
- `GET /api/chapters` now carries `choices` on player messages.
- Not wired, because the files belong to other tasks: a line when a chapter's last level passes, a line when the
  whole stack goes down, and `scripts/stop` removing the stage file.
- The Hinglish lines were read by nobody but the agent that wrote them.

### D-03: seven more hands-on panels, and completion for the Redis client
Adds:
- Hands-on versions of seven show-me panels (stream, JSON, bitmap, HyperLogLog, geo, Bloom filter, time series).
  Each shows the command it will run, then the command it ran. 13 of the 19 panels are now hands-on, and the six
  that stay read-only say why.
- Completion in the editor for the learner's Redis client, from a member list generated out of the installed
  `redis` package (`scripts/dev/gen-client-api.mjs`).

Before it merges:
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

Before it merges:
- Unchecked: that the proxy passes the `x-quest-trace` header both ways, and that the ticker's match (`m-041`)
  exists in the seed.
- `deps.redisCached` is not traced, so a cache hit shows no Redis bar.
- The trace wraps the counted client inside `app/` and not in the shared package (not this task's file).

### D-05: the level studio and community levels
Adds:
- `/studio`: write a level in a form, see it validated by the engine's own validator as you type, preview it with
  the real components, play-test it against your Redis, and get the files as a zip with the git commands to send.
- Community levels: `levels/community/<pack>/`, their own loader and rules, `/community` and a level screen, one
  sample level by the house, `scripts/level-new`, and an optional `author` on a level.

Before it merges:
- It changes the campaign loader, which now skips a directory named `community`. Confirm the grader's totals did
  not move (316 rows at the last full run).
- A community level is `cli` or `decision` only, and its screen has no interview, slots, traffic or show-me panel.
- Nobody has opened the screens: expect layout fixes.

### D-06: your turn, the wanted-commands board, the credits
Built on D-05: this pull request goes into `day-05-level-studio`, not `main`.

Adds:
- `/your-turn`: three steps that tick themselves. Pick a command no level teaches, play-test a level about it in
  the studio, open the pull request.
- The wanted-commands board (`GET /api/coverage`): every command the server lists, set against what the levels
  teach.
- `/credits`: the cast, the authors of community levels, `CONTRIBUTORS.md` (new), and the player's own line.

Before it merges:
- Merge D-05 first, then point this pull request at `main`.
- The engine image now copies `fiction/cast.json` and `CONTRIBUTORS.md` (added on the branch, never built).
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

Before it merges:
- **Every par, every house entry and every "this can be beaten" note is unproven**: nothing ran against a Redis.
- Scoring empties and uses logical database 7 on a connection of its own, and refuses to run unless the server
  says it is on database 7. A cluster is refused. The Redis behaviour this relies on (`CLIENT INFO` reporting the
  database, the replies of `MEMORY USAGE`) is not in the digest: not verified.
- The engine image now copies `golf/` (added on the branch, never built).

### D-08: the arcade and its first cabinet, "Be the Redis"
Adds:
- `/arcade`, and a kit for building cabinets (seeded random, a fixed-step clock, best scores, a frame, a list
  where every rule names its source), with `docs/arcade.md` on adding one in a single folder.
- The first cabinet, "Be the Redis": commands arrive on a belt and you serve them one at a time. The words on a
  card are the server's own; how long a command takes is the game's model, and the cabinet says so.

Before it merges:
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

Before it merges:
- **It changes a running Redis on purpose and relies on an undo journal that has never run.** Prove the undo on
  an isolated stack before it goes near a real save.
- The budgets are chosen, not measured: 1% errors, 400 ms p99, 800 ms in an over with an incident.
- It refuses Sentinel and cluster targets. The routes are not behind a player check.
- The engine image now copies `incidents/` (added on the branch, never built).

### D-10: the launch kit
Adds:
- A docs site generator (`scripts/site/build.mjs`): home, a catalogue of the 96 levels, a commands index, a page
  on grading and a page on contributing. `.github/workflows/pages.yml` builds it and deploys only when the
  repository variable `PAGES_ENABLED` is `true`.
- Twenty starter issues as drafts (`docs/launch/issues/`) and a script that files them
  (`scripts/launch/create-issues.sh`, with `--dry-run`).
- Launch posts as drafts (`docs/launch/posts/`), each claim mapped to the file or command that proves it, and
  `docs/launch/CHECKLIST.md`.
- README corrections outside the contributing section.

Before it merges:
- Owner first: the name question (the checklist links Redis's trademark policy and does not interpret it), and
  the `[OWNER ...]`, `[SITE URL ...]` and `[LINK ...]` brackets in the posts.
- Never run: the issues script (not even its dry run), `scripts/launch/facts.mjs`, the Pages workflow. The site
  generator ran once and its output was read as text only.
- `scripts/check/D-10.sh` is marked docker-free, so CI runs it on this pull request.

## How to resume
1. Read "Decide before any pull request is opened" above. If it is still open, ask Puneet before anything else.
2. `git fetch origin` and list the day branches: `git branch -r | grep day-`.
3. For each day, read `docs/handoffs/D-0n.md` on its branch
   (`git show origin/<branch>:docs/handoffs/D-0n.md`). "code complete and unverified" means the code is there
   and has never run; "in progress" lists what remains.
4. Worktrees live in `~/personal-repo/Redis-Quest.worktrees/<branch>` (durable; the scratch folder is cleared on
   reboot). Recreate a missing one with `git worktree add ~/personal-repo/Redis-Quest.worktrees/<branch> <branch>`
   and run `pnpm install --frozen-lockfile --offline` in it.
5. Unfinished day: give a subagent `specs/_days-common.md`, the day's spec and its handoff, and tell it to
   continue on the same branch, with the no-reply git identity.
6. Pull requests: see "Opening the pull requests". CI runs on every pull request: that is the first real test of
   each branch. Ten at once is fine for GitHub; it costs this Mac nothing.
7. Verification, when the Mac has room (one branch at a time): `pnpm install --frozen-lockfile`,
   `pnpm -r build`, `pnpm -r lint`, `pnpm -r test` against an isolated Redis and Postgres, the day's
   `scripts/check/D-0n.sh`, then the "How to verify" section of its handoff. Never a bare `docker compose`:
   the default project is the owner's game (`scripts/check/lib/isolate.sh`).

## Also parked
- The tag `v1.1.0-rc1`: the tester guide and invite still name `v1.0.0-rc2`. It needs a fresh-clone start test
  first (clone, own ports in `.env`, `COMPOSE_PROJECT_NAME=quest-fresh`, `./scripts/start`, the first-run flow in
  a browser, `down -v`). One attempt stalled in preflight on 2026-11-19 and was never explained.
