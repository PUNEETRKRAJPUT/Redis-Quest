# The launch posts: drafts, and how to check them

Nothing here is posted. Four drafts:

| File | For | Length |
| --- | --- | --- |
| `01-show-hn.md` | Show HN: title, text, a first comment | about 400 words |
| `02-redis-community.md` | a Redis community of your choice | about 450 words |
| `03-thread.md` | a seven-post thread, with images | seven posts under 280 characters |
| `04-how-it-was-built.md` | a blog post: spec, check, handoff, parallel agents, the incident | about 1,500 words |

Rules the drafts follow, and that an edit should keep: every sentence is true of the repository and checkable in it;
no number from memory; no superlatives; no claim about what learners achieve (nobody except the owner has played the
game yet, and the posts say so); no feature that is not on `main`; the name is introduced with the line that the
project is not affiliated with or endorsed by Redis. Square brackets mark text the owner fills in or deletes.

## Where each claim comes from

Run these from the repository root before posting. If a number differs, change the post, not the number.

| Claim | Check |
| --- | --- |
| 8 chapters, 96 levels | `pnpm --silent --filter @quest/shared levels:validate levels` prints `8 chapter(s), 96 level(s)` |
| 93 levels carry their own solutions, 297 declared, 26 "works, but wrong", the three mock interviews draw | `node scripts/launch/facts.mjs` (prints these counts from the level files) |
| Real `redis:8`, `postgres:16`, Redis Insight, Caddy | `grep -n "image:" docker-compose.yml` |
| Apple Silicon, 16 GB, Docker Desktop with 8 GB; Windows, Intel and Linux not supported | `README.md` sections "Who it is for" and "What you need"; `scripts/preflight.sh` |
| Local only, nothing phones home, MIT | `README.md` "Under the hood" and "Licence"; `LICENSE` |
| No AI features in the game | `CLAUDE.md`, "What this is" |
| Checks run on the live stack (behaviour under concurrency, traffic against a recorded baseline, read-only Redis reads, "works, but wrong") | `README.md` "How your work is graded"; `docs/grading.md` |
| One task, one spec, one check, one handoff, one commit; agents do not edit the board or commit | `CLAUDE.md`, "How work happens" |
| Waves, tasks in parallel on disjoint files; nine of twelve Phase 0 tasks on the smaller model | `docs/BUILD.md`, the Phase 0 table and the sentence under it |
| 55 task specs outside the ten-day plan, a handoff for each | `ls docs/specs \| grep -v '^_' \| grep -vc '^D-'` and `ls docs/handoffs \| grep -vc '^D-'` |
| Last full run: 316 PASS, 0 MISMATCH, 6 skipped | `docs/BUILD.md`, decisions log, 2026-11-19; `docs/ci-local.log` |
| The incident: `P0-01.sh` and the default project, four runs, one key and six outbox rows, the fix | `docs/handoffs/G-03.md`; `docs/BUILD.md`, decisions log, 2026-11-19 |
| `quest_isolate` refuses to run on the default project (exit 99); the CI tripwire | `scripts/check/lib/isolate.sh`; `scripts/check/G-03.sh` |
| Redis facts come from a digest of redis.io/docs/latest fetched on 2026-11-01 | first line of `docs/redis-docs-digest.md` |
| Nobody except the owner has played it; invite written, not sent | `docs/BUILD.md`, row T1 ("invite ready; send when you choose"); ask the owner before posting |
| Safari and Firefox untested; sound cues not heard by a person | `docs/BUILD.md`, decisions log, 2026-11-19 ("Open follow-ups") |
