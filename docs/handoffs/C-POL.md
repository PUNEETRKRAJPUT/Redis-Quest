# C-POL handoff: README, tester docs on `v1.0.0-rc2`, follow-up questions on the nine chapter interviews

## What I did
- **`README.md`** replaced. Sections: What it is (untitled intro), Who it is for, What you need, Start, The eight chapters, How a level
  works, The tools, Where your work lives, Stop / reset and start over, Troubleshooting (with the port table), Contributing and how it was
  built, Licence (unchanged in substance). The chapter table's counts come from the level files (5, 16, 13, 15, 19, 7, 14, 7 = 96) and
  the check recomputes them. "Windows and Intel Macs are not supported" is stated plainly; no Redis fact appears.
- **`docs/TESTING.md`, `docs/TESTER-MESSAGE.md`** point at `v1.0.0-rc2` (the guide clones it with `--branch`, the message links the
  guide at that tag), say the whole game is playable (eight chapters, 96 levels), say how long a chapter takes is unknown and ask for
  start/stop times, keep the issue template flow and the do-not-help / do-not-ask rules, and add the target switcher and the Chapter 5
  extra containers.
- **Follow-up questions** on the nine chapter interviews: `interview.questions`, three each. Taken from the Finale's pool entry for the
  same `rebuild_of`: same options, same correct ids, same explanations. Only the question sentence was rewritten, because the pool's
  are in Mukul's voice (the third-round panel) and these levels' interviewers are the alumni senior (Chapter 2) and the interviewer of
  each Chapter 3 and 4 level.
- **`scripts/check/C-POL.sh`** (bash 3.2, no Docker).

## Schema: landed in time
`interview.questions` was already in `packages/shared/src/levels/schema.ts` when I started on the questions (E-05). I trial-validated a
scratch copy of `levels/_examples/example-interview` (with its `example-code` chapter, since `rebuild_of` needs it) before editing any
real level; it validated. The questions are in.

## Explanations I changed (and why)
Learner-facing text must not point at a chapter the learner has not reached. Seven explanation fragments in the Finale's pool entries
named later chapters; I removed or reworded them in the copies (the Finale's own entries are untouched):
- ch2 cache-aside, 2nd question: dropped "Level 3.1 showed the opposite ..." and replaced it with a plain sentence about a per-process counter.
- ch2 cache-aside, 3rd question: dropped "Level 4b.1:" and "(level 5.6)".
- ch2 session store, 1st: dropped "(level 4b.3)"; 3rd: dropped "Chapter 5:" and "(level 5.1)".
- ch3 ticker, 1st: "(Chapter 4)" became "which is the next chapter"; 3rd: "the same duplicate() you used for BLMOVE in level 4.7" became "the same
  duplicate() gives a blocking command, such as BLMOVE, its own connection too" (same claim as the original, no later level named).
- ch4 ops wall, 1st: dropped "and KEYS in a cron is level 4b.3 again".
The check fails if any question names a later level or chapter.

## Questions (level, the three questions, correct ids)
| Level | Interviewer | Questions (short) | Correct ids |
|---|---|---|---|
| ch2-11-interview-cache-aside | alumni senior | Redis restarts empty; a second app copy; one player on every phone | ca1-refills, ca2-nothing, ca3-local |
| ch2-12-interview-prefetch | alumni senior | every cache:match key deleted; sync worker asleep ten minutes; why delete and rewrite the hash | pf1-null, pf2-reload, pf3-dropped-fields |
| ch2-13-interview-session-store | alumni senior | log one account out everywhere; an eight-hour cap on a sliding expiry; Redis restarted at lunch | ss1-set, ss2-cap, ss3-depends |
| ch3-13-interview-rate-limiter | payments lead | Redis unplugged ten seconds; a hundred at once and one Lua script; servers disagree about time | tb1-policy, tb2-atomic, tb3-cost |
| ch3-14-interview-leaderboard | interviewer | equal points, who ranks higher; a thousand refreshing the top ten; two servers score at once | lb1-member, lb2-ordered, lb3-incr |
| ch3-15-interview-ticker | interviewer | phone loses signal for ten seconds; PUBLISH printed 0; why the subscriber has its own connection | tk1-last, tk2-nobody, tk3-own |
| ch4-17-interview-streaming | data platform lead | worker dies before XACK; a poison ball; which command shows stuck balls | st1-twice, st2-delivery, st3-xpending |
| ch4-18-interview-job-queue | staff engineer | a worker's box killed; reclaimer hands a slow job on; why a second connection | jq1-processing, jq2-fence, jq3-block |
| ch4-19-interview-time-series-dashboard | observability head | memory growth; buckets that change shape; p99 across every route | ow1-retention, ow2-align, ow3-tdigest |

## What I did not do / noticed
- `.prettierignore` lists `docs/`, `*.md` and `levels/`, so `pnpm format:check` does not look at any file I changed. I ran prettier on
  the three markdown files directly (`--ignore-path /dev/null`; it reformatted the README's tables) and the check does both. The nine
  YAML files are not prettier-checked (ignored by design).
- The README mentions things I took from the handoffs and the UI source, not from a browser: the Logs and Metrics sidebar pages, the
  target switcher's five presets plus a custom URL, "Run traffic" and "Run my code in the app". Not looked at in a running UI.
- "The 60 MB seed" is the spec's figure; the repo holds the seed gzipped (BUILD.md says 11 MB), and I did not measure the loaded size.
- The README says the game's `workspace/` files are untouched by `scripts/stop` and `scripts/reset`. Neither script touches them (read);
  I did not run either (no Docker, as told).
- The README links `levels/README.md`, which E-05 or another agent is editing right now; the link target exists.
- The tester docs say the four profile levels of Chapter 5 were played by hand by the author; that is the BUILD.md decision-log wording
  ("the four profile levels ... played by hand"). The orchestrator creates the tag `v1.0.0-rc2`; until it exists the links 404.
- For the orchestrator: `docs/BUILD.md` still says T1 testers use `v0.1.0`; and the session cache lists the README and the questions as
  backlog. I did not touch either.

## Check output (`scripts/check/C-POL.sh`, exit 0)
```

== README: a row per chapter directory, level counts computed from the files
PASS  levels/ch0-boot: 5 level files, 5 listed in chapter.yaml
PASS  README row: 0 | Boot | 5
PASS  levels/ch1-keyspace: 16 level files, 16 listed in chapter.yaml
PASS  README row: 1 | The keyspace | 16
PASS  levels/ch2-everyone-showed-up: 13 level files, 13 listed in chapter.yaml
PASS  README row: 2 | Everyone showed up | 13
PASS  levels/ch3-compete-and-talk: 15 level files, 15 listed in chapter.yaml
PASS  README row: 3 | Compete and talk | 15
PASS  levels/ch4-work-in-the-background: 19 level files, 19 listed in chapter.yaml
PASS  README row: 4 | Work in the background | 19
PASS  levels/ch4b-on-call: 7 level files, 7 listed in chapter.yaml
PASS  README row: 4b | On call | 7
PASS  levels/ch5-survive: 14 level files, 14 listed in chapter.yaml
PASS  README row: 5 | Survive and scale | 14
PASS  levels/finale: 7 level files, 7 listed in chapter.yaml
PASS  README row: Finale | The architect | 7
PASS  README has 8 chapter rows for 8 chapter directories
PASS  README says there are 96 levels (the sum of the files)
PASS  README says eight chapters
PASS  8 chapter directories

== README: scripts, ports, the plain statements
PASS  mentions scripts/start
PASS  scripts/start exists
PASS  mentions scripts/stop
PASS  scripts/stop exists
PASS  mentions scripts/reset
PASS  scripts/reset exists
PASS  mentions scripts/preflight.sh
PASS  scripts/preflight.sh exists
PASS  mentions .env.example
PASS  .env.example exists
PASS  mentions port 3000
PASS  mentions port 5540
PASS  mentions port 6379
PASS  mentions port 5432
PASS  mentions port 6380
PASS  mentions port 26379
PASS  mentions port 26380
PASS  mentions port 26381
PASS  mentions port 7100
PASS  mentions port 7105
PASS  PROXY_PORT is in .env.example and the README
PASS  INSIGHT_PORT is in .env.example and the README
PASS  REDIS_PORT is in .env.example and the README
PASS  PG_PORT is in .env.example and the README
PASS  says plainly that Windows and Intel Macs are not supported
PASS  mentions 'Apple Silicon'
PASS  mentions '16 GB'
PASS  mentions 'Docker Desktop'
PASS  mentions '8 GB'
PASS  mentions 'Git'
PASS  mentions 'localhost:3000'
PASS  mentions 'localhost:5540'
PASS  mentions 'Run my code in the app'
PASS  mentions 'Run traffic'
PASS  mentions 'Target switcher'
PASS  mentions 'Write my story'
PASS  mentions 'What you built'
PASS  mentions '.progress/progress.json'
PASS  mentions 'workspace/'
PASS  mentions 'Works, but wrong'
PASS  mentions 'The ideal way'
PASS  mentions '60 MB'
PASS  mentions '10 GB'
PASS  the licence section is unchanged in substance
PASS  section: What you need
PASS  section: The eight chapters
PASS  section: How a level works
PASS  section: The tools
PASS  section: Where your work lives
PASS  section: Stop, reset and start over
PASS  section: Troubleshooting
PASS  section: Contributing
PASS  section: Licence
PASS  link target exists: workspace/README.md
PASS  link target exists: docs/BUILD.md
PASS  link target exists: docs/PLAN.md
PASS  link target exists: docs/fiction.md
PASS  link target exists: docs/grading.md
PASS  link target exists: levels/README.md
PASS  link target exists: docs/TESTING.md
PASS  README names no build task id

== TESTING.md and TESTER-MESSAGE.md on v1.0.0-rc2
PASS  docs/TESTING.md mentions v1.0.0-rc2
PASS  docs/TESTING.md names no older tag
PASS  docs/TESTING.md says 96 levels
PASS  docs/TESTING.md mentions the target switcher
PASS  docs/TESTING.md mentions Chapter 5's extra containers
PASS  docs/TESTER-MESSAGE.md mentions v1.0.0-rc2
PASS  docs/TESTER-MESSAGE.md names no older tag
PASS  docs/TESTER-MESSAGE.md says 96 levels
PASS  docs/TESTER-MESSAGE.md mentions the target switcher
PASS  docs/TESTER-MESSAGE.md mentions Chapter 5's extra containers
PASS  the message links the guide on v1.0.0-rc2
PASS  the guide clones v1.0.0-rc2
PASS  TESTING.md keeps the issue template flow
PASS  the message keeps 'do not ask me anything'
PASS  TESTING.md keeps the do-not-help rule
PASS  TESTING.md says chapter time is unknown and asks for a note

== the nine interviews: three questions each, correct ids from the Finale's pool
PASS  shared build
PASS  ch2-11-interview-cache-aside: exactly 3 questions
PASS  ch2-11-interview-cache-aside: correct ids ca1-refills,ca2-nothing,ca3-local match the Finale's entry for ch2-02-cache-aside-v1
PASS  ch2-11-interview-cache-aside: option ids are the Finale's, in order
PASS  ch2-11-interview-cache-aside: each is a quiz with its answer among the options and an explanation
PASS  ch2-11-interview-cache-aside: not in Mukul's voice
PASS  ch2-11-interview-cache-aside: names no later chapter
PASS  ch2-12-interview-prefetch: exactly 3 questions
PASS  ch2-12-interview-prefetch: correct ids pf1-null,pf2-reload,pf3-dropped-fields match the Finale's entry for ch2-07-fixtures-must-never-miss
PASS  ch2-12-interview-prefetch: option ids are the Finale's, in order
PASS  ch2-12-interview-prefetch: each is a quiz with its answer among the options and an explanation
PASS  ch2-12-interview-prefetch: not in Mukul's voice
PASS  ch2-12-interview-prefetch: names no later chapter
PASS  ch2-13-interview-session-store: exactly 3 questions
PASS  ch2-13-interview-session-store: correct ids ss1-set,ss2-cap,ss3-depends match the Finale's entry for ch2-08-otp-login-properly
PASS  ch2-13-interview-session-store: option ids are the Finale's, in order
PASS  ch2-13-interview-session-store: each is a quiz with its answer among the options and an explanation
PASS  ch2-13-interview-session-store: not in Mukul's voice
PASS  ch2-13-interview-session-store: names no later chapter
PASS  ch3-13-interview-rate-limiter: exactly 3 questions
PASS  ch3-13-interview-rate-limiter: correct ids tb1-policy,tb2-atomic,tb3-cost match the Finale's entry for ch3-03-token-bucket
PASS  ch3-13-interview-rate-limiter: option ids are the Finale's, in order
PASS  ch3-13-interview-rate-limiter: each is a quiz with its answer among the options and an explanation
PASS  ch3-13-interview-rate-limiter: not in Mukul's voice
PASS  ch3-13-interview-rate-limiter: names no later chapter
PASS  ch3-14-interview-leaderboard: exactly 3 questions
PASS  ch3-14-interview-leaderboard: correct ids lb1-member,lb2-ordered,lb3-incr match the Finale's entry for ch3-06-the-real-leaderboard
PASS  ch3-14-interview-leaderboard: option ids are the Finale's, in order
PASS  ch3-14-interview-leaderboard: each is a quiz with its answer among the options and an explanation
PASS  ch3-14-interview-leaderboard: not in Mukul's voice
PASS  ch3-14-interview-leaderboard: names no later chapter
PASS  ch3-15-interview-ticker: exactly 3 questions
PASS  ch3-15-interview-ticker: correct ids tk1-last,tk2-nobody,tk3-own match the Finale's entry for ch3-10-the-ticker
PASS  ch3-15-interview-ticker: option ids are the Finale's, in order
PASS  ch3-15-interview-ticker: each is a quiz with its answer among the options and an explanation
PASS  ch3-15-interview-ticker: not in Mukul's voice
PASS  ch3-15-interview-ticker: names no later chapter
PASS  ch4-17-interview-streaming: exactly 3 questions
PASS  ch4-17-interview-streaming: correct ids st1-twice,st2-delivery,st3-xpending match the Finale's entry for ch4-03-a-worker-died
PASS  ch4-17-interview-streaming: option ids are the Finale's, in order
PASS  ch4-17-interview-streaming: each is a quiz with its answer among the options and an explanation
PASS  ch4-17-interview-streaming: not in Mukul's voice
PASS  ch4-17-interview-streaming: names no later chapter
PASS  ch4-18-interview-job-queue: exactly 3 questions
PASS  ch4-18-interview-job-queue: correct ids jq1-processing,jq2-fence,jq3-block match the Finale's entry for ch4-07-the-job-queue
PASS  ch4-18-interview-job-queue: option ids are the Finale's, in order
PASS  ch4-18-interview-job-queue: each is a quiz with its answer among the options and an explanation
PASS  ch4-18-interview-job-queue: not in Mukul's voice
PASS  ch4-18-interview-job-queue: names no later chapter
PASS  ch4-19-interview-time-series-dashboard: exactly 3 questions
PASS  ch4-19-interview-time-series-dashboard: correct ids ow1-retention,ow2-align,ow3-tdigest match the Finale's entry for ch4-16-the-ops-wall
PASS  ch4-19-interview-time-series-dashboard: option ids are the Finale's, in order
PASS  ch4-19-interview-time-series-dashboard: each is a quiz with its answer among the options and an explanation
PASS  ch4-19-interview-time-series-dashboard: not in Mukul's voice
PASS  ch4-19-interview-time-series-dashboard: names no later chapter
PASS  nine interview levels found

== the whole levels tree validates
PASS  levels:validate: OK (8 chapter(s), 96 level(s))
PASS  8 chapters and 96 levels

== formatting
PASS  pnpm format:check
PASS  prettier: README.md, docs/TESTING.md, docs/TESTER-MESSAGE.md

C-POL: ALL CHECKS PASSED
```
