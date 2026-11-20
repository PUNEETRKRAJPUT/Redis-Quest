# The ten-day plan: status and how to resume

Puneet asked on 2026-11-20 for the whole ten-day plan at once, as ten pull requests, built by Sonnet subagents.
Shortly after he asked for it to be **resumable** and, for now, **code and parked pull requests only, with no
local runs**: his Mac was short on memory and disk. So every branch below is written without being run. Nothing
here is verified beyond a type check and a lint.

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
| Day | Code | Pushed | Pull request | Verified |
|---|---|---|---|---|
| D-01 | not started | no | none | no |
| D-02 | not started | no | none | no |
| D-03 | not started | no | none | no |
| D-04 | not started | no | none | no |
| D-05 | not started | no | none | no |
| D-06 | not started | no | none | no |
| D-07 | not started | no | none | no |
| D-08 | not started | no | none | no |
| D-09 | not started | no | none | no |
| D-10 | not started | no | none | no |

The truth for a day is its branch on GitHub and `docs/handoffs/D-0n.md` on that branch (sections Status, Done,
Remaining). If this table and a branch disagree, the branch is right.

## How to resume
1. `git fetch origin` and list the day branches: `git branch -r | grep day-`.
2. For each day, read `docs/handoffs/D-0n.md` on its branch
   (`git show origin/<branch>:docs/handoffs/D-0n.md`). "code complete and unverified" means the code is there
   and has never run; "in progress" lists what remains.
3. Worktrees live in `~/personal-repo/Redis-Quest.worktrees/<branch>` (durable; the scratch folder is cleared on
   reboot). Recreate a missing one with `git worktree add ~/personal-repo/Redis-Quest.worktrees/<branch> <branch>`
   and run `pnpm install --frozen-lockfile --offline` in it.
4. Unfinished day: give a subagent `specs/_days-common.md`, the day's spec and its handoff, and tell it to
   continue on the same branch.
5. Pull requests: `gh` on this Mac is logged in as the work account, which can only read this repository. Either
   the owner opens each one from `https://github.com/PUNEETRKRAJPUT/Redis-Quest/compare/main...<branch>?expand=1`
   (D-06 against `day-05-level-studio`), or logs `gh` in with the personal account first. CI runs on every pull
   request: that is the first real test of each branch.
6. Verification, when the Mac has room (one branch at a time): `pnpm install --frozen-lockfile`,
   `pnpm -r build`, `pnpm -r lint`, `pnpm -r test` against an isolated Redis and Postgres, the day's
   `scripts/check/D-0n.sh`, then the "How to verify" section of its handoff. Never a bare `docker compose`:
   the default project is the owner's game (`scripts/check/lib/isolate.sh`).

## Also parked
- The tag `v1.1.0-rc1`: the tester guide and invite still name `v1.0.0-rc2`. It needs a fresh-clone start test
  first (clone, own ports in `.env`, `COMPOSE_PROJECT_NAME=quest-fresh`, `./scripts/start`, the first-run flow in
  a browser, `down -v`). One attempt stalled in preflight on 2026-11-19 and was never explained.
