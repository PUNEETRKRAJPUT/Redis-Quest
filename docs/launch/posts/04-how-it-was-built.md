# Draft: how Redis Quest was built (spec, check, handoff)

Status: draft, not published. A long post for a blog, dev.to or a repository discussion. Every claim below is meant
to be checkable in the repository; the map is in `docs/launch/posts/README.md`. Text in square brackets is for the
owner. If the project is renamed (see `docs/launch/CHECKLIST.md`) change the name in the first paragraph and the last.

---

# How I built a Redis learning game with coding agents, and the day a check stopped my own game

Redis Quest is a local game for backend engineers who have never used Redis: eight chapters, 96 levels, a fictional
cricket league, Docker Compose on an Apple Silicon Mac. You play the backend developer of a fantasy cricket app, and
each level is one thing that went wrong that night, fixed against a real Redis, a real Postgres and real traffic. It
is an independent project and is not affiliated with or endorsed by Redis. Its repository is public and MIT licensed:
https://github.com/PUNEETRKRAJPUT/Redis-Quest

This post is about how it was built, because the way it was built is the part I can describe honestly. What I cannot
describe yet is how well it teaches: it is a release candidate and nobody except me has played it. The tester guide
and the invite are written (`docs/TESTING.md`, `docs/TESTER-MESSAGE.md`) and had not been sent when I wrote this.

## One task, one spec, one check, one handoff, one commit

The project was built in small tasks, and every task had the same five parts, written down in `CLAUDE.md`:

1. **A spec** in `docs/specs/<id>-<slug>.md` that lists the files the task owns. An agent that needs to touch a file
   outside that list stops and says so in its handoff instead.
2. **A check**: `scripts/check/<id>.sh`, which exits 0 on success and prints what it verified. The agent runs it
   before handing off and pastes the output into the handoff.
3. **A handoff** in `docs/handoffs/<id>.md`: what it did, what it verified (commands and results), what it did not
   do, what surprised it, what the next agent must know. Always, even on a clean finish.
4. **No status changes and no commits by the agent.** The board, `docs/BUILD.md`, is edited only by the session that
   orchestrates the work, after it has run the task's check itself and read the handoff.
5. **One commit per task** on `main`, by that session.

The rule that earned its keep most is the last line of the handoff section: never invent a Redis fact. A fact in a
lesson must be in `docs/redis-docs-digest.md` (notes taken from redis.io/docs/latest on 2026-11-01, which also records
where the docs contradict each other) or in the official docs, or be labelled as measured on this stack, or the handoff
says "not verified". Several handoffs end with a list of exactly that: statements the lesson makes that the digest does
not back, so a human can look.

In the repository today there are 55 task specs outside the ten-day plan and a handoff for each. Those counts will
move; count them again before you quote them.

## Parallel agents, in waves

Tasks that own different files can run at the same time, so the board runs them in waves: "Waves run in order; tasks
within a wave run in parallel because they own disjoint files" (`docs/BUILD.md`). The board also records which model
ran each task; in the Phase 0 table, nine of the twelve tasks ran on the smaller model and three on the larger one,
which I used for the schema, the app skeleton and the verifier engine. [OWNER: name the tools and models.]

Parallel work found its own failures, and the decisions log keeps them as rules: the engine refuses to start on an
invalid level by design, so content agents must keep a chapter valid at every save (write the level file before
listing it in `chapter.yaml`); a lockfile has to be committed with the manifest that changes it; a check that counts
connections on a shared server has to count its own.

## Checks that grade the levels, not just the code

Every level (the three drawn mock interviews aside) ships a reference solution and at least one known-wrong one, each
declaring the verdict it must get. In the level files today that is 93 levels carrying 297 declared solutions, 26 of
them marked "works, but wrong". A grading harness (`scripts/grade/grade.sh`, described in `docs/grading.md`) plays each
one through the real engine the way a learner would and prints a truth table:

```
LEVEL       SOLUTION                      DECLARED          ENGINE            RESULT
ch1-07      07-reference.redis            right             right             PASS
ch1-07      07-works-but-wrong-list...    works_but_wrong   right             MISMATCH
```

A level is only done when its table has no MISMATCH row. The last full run recorded on the board (2026-11-19) is 316
PASS and 0 MISMATCH, with six rows skipped that need a real outage or the cluster join and were played by hand.

The harness found things nobody had planned for. Live grading showed that a 4xx answer has to count as answered in
the traffic verifier, that ops levels must put Redis's configuration back, and that a level cannot depend on a file a
learner wrote in an earlier level. A Sentinel left running will demote the master that comes back, so the harness
resets the topology between solutions. All of that is in the decisions log.

## The day a check stopped my own game

On 2026-11-19 I was integrating the new interface. `scripts/check/P0-01.sh` ran `docker compose up -d redis postgres`,
then `pnpm -r test` against those services, then `docker compose stop redis postgres`, all without naming a Compose
project. `docker-compose.yml` declares `name: redis-quest`, and `redis-quest` is the project my own copy of the game
runs in. The script was run four times while my game was up. Each time it stopped my Redis and Postgres (the last time
for about five minutes), and the app and runner unit tests ran against my data.

Nothing was lost, and I know that because the cleanup was done by evidence. The handoff (`docs/handoffs/G-03.md`)
records what was compared before anything was touched: the save file, the progress API, the Redis mirror, every key
by prefix, and the row count of every Postgres table against a second stack built from the same seed. Two things
differed: one test key, and six rows in the `outbox` table created between 05:44 and 06:17 UTC, the time of the runs.
The six rows were saved as JSON and deleted with the key, and nothing else was removed.

The cause was not a typo. The check never named a project, and a bare `docker compose` in this repository means "the
default project", which is the real game.

What changed, in `docs/handoffs/G-03.md` and the board's decisions log:

- **`scripts/check/lib/isolate.sh`**: a check that drives Compose calls `quest_isolate` first. It gives the check its
  own project name, ports, image tag and scratch directories, exports the Compose variables so even a bare call is
  isolated, and then asks Compose which project a bare call would use. If the answer is not its own it prints
  `REFUSING TO RUN` and exits 99.
- **Six Phase 0 checks converted** (P0-01, P0-02, P0-06, P0-07, P0-08, P0-11). Each was run beside a running
  `redis-quest` project, with the ids, states and start times of its containers compared before and after.
- **A tripwire in CI**: `scripts/check/G-03.sh` needs no Docker and scans every `scripts/check/*.sh` for a Compose call
  that is not scoped, including a wrapper that passes its arguments to an unscoped one. Run against the five original
  scripts from git, it reports five failures.
- **A rule in the decisions log** (`docs/BUILD.md`, 2026-11-19): a check that drives Compose calls `quest_isolate` or
  scopes every call with `-p`, and `G-03.sh` enforces it.

The handoff also lists what is not done: the older A-, E-, F- and grading-harness checks already scoped their calls
with `-p`, but were not converted to the helper; `scripts/start`, `scripts/stop` and `scripts/reset` act on the default
project on purpose, because the player runs them on their own game. And it records a surprise from the new isolation:
starting from an empty Postgres volume showed that the container's health check can answer before the real server
accepts connections (measured on this stack, not a claim about Postgres in general).

## What I do not know

- Whether it teaches. Nobody else has played it, so I have no completion times, no list of where people get stuck, and
  no evidence that the verdict messages help.
- How it looks and sounds in other browsers. The project log lists Safari and Firefox as untested, and the sound cues as
  not yet heard by a person.
- Whether the Redis lessons are right where the docs are thin. That is the main reason to publish.

If you try it, the first chapter is the useful part: tell me where you stopped, even for thirty seconds. The playtest
issue template asks for that and for your Mac's memory settings.
