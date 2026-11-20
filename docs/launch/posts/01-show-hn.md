# Draft: Show HN

Status: draft, not posted. Read `docs/launch/CHECKLIST.md` first: the name question comes before anything is
posted, and if the name changes every "Redis Quest" below changes with it. Text in square brackets is for the owner
to fill or delete. The map of claim to file is in `docs/launch/posts/README.md`.

Before posting, read the current Show HN rules and guidelines on news.ycombinator.com and check that this fits them.
Do not ask anyone to upvote.

## Title (80 characters or fewer)

```
Show HN: Redis Quest, a local game that teaches Redis by fixing a cricket app
```

## URL

The repository: https://github.com/PUNEETRKRAJPUT/Redis-Quest

## Text

Redis Quest is a game for backend engineers who have never used Redis. You play the backend developer of a fantasy
cricket app that you and a roommate built in a weekend. Each chapter is a night when something breaks ("the stats
page is a four-second spinner", "the leaderboard is gone after a restart"), and each level is one thing to do about
it, against a real Redis 8, a real Postgres and real load on your own Mac: type commands in a terminal, or write one
JavaScript function that the game loads into a running Fastify app.

There are 8 chapters and 96 levels, from `docker compose up` to a Sentinel failover and a cluster migration. Nothing
is graded by reading your code. A level declares checks that run against the live stack: your function is called on
a sandboxed runner (a hundred or two hundred times at once when the lesson is a race), traffic is run against the app
and compared with a baseline the game recorded itself, and Redis is read back with read-only commands. A verdict of
"works, but wrong" exists for answers that pass today and fail under load.

Before you try it: it needs an Apple Silicon Mac with 16 GB of RAM and Docker Desktop with 8 GB assigned. Windows,
Intel Macs and Linux are not supported. Everything runs locally, nothing is hosted, no account is needed. MIT
licensed. The repository has a docs site with screenshots and the full level catalogue for anyone who cannot run it.

Where it stands: this is a release candidate, and nobody except me has played it yet. I do not know how long a
chapter takes, where people get stuck, or whether it teaches what I want it to. That is why I am posting. If you want
to help, play Chapter 0 and the first levels of Chapter 1 and tell me where you stopped.

Redis Quest is an independent project and is not affiliated with or endorsed by Redis.

## First comment (post it yourself, right after the submission)

A few details that did not fit above.

What a level is: one YAML file (story, a brainstorm step where you commit to a guess before any teaching, a short
lesson, the task, the checks) plus a reference solution and at least one known-wrong solution. A grading harness
plays every declared solution through the real engine and compares the verdict with what the level declares, so a
level whose "wrong" answer actually passes is caught. In the level files today, 93 levels carry their own solutions
(297 declared in total, 26 of them marked "works, but wrong"); the three mock interviews in the finale draw one of
the earlier use cases at random and grade it with that level's solutions.

What is real and what is not: the Redis, Postgres, load generator and app are real. The players are fake and the
league is fictional. Numbers in the story ("forty thousand teams") are story numbers, not statistics. Measurements
the game states about itself are labelled as measured on this stack.

What it does not do: no AI features anywhere in the game. It is not a replacement for the Redis documentation;
every lesson links to the official page, and the facts it states come from a digest of those pages
(`docs/redis-docs-digest.md`). Where the docs disagree with each other the digest says so, and where a fact is not in
the digest or the docs the handoff notes say "not verified".

How it was built: in small tasks, each with a written spec, a check script and a handoff note, by coding agents
working in parallel on tasks that touch different files, with one session re-running every check before it commits.
[OWNER: name the tools and models you used.] I wrote about that and about the time a check script stopped my own
running game: [LINK to the write-up once it is published].

If you try it and get stuck anywhere, even for thirty seconds, the playtest issue template asks for exactly that.
