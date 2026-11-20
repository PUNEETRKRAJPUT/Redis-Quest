# Draft: a post for a Redis community

Status: draft, not posted. Pick the place first (the Redis subreddit, the Redis Discord, a Redis user group, a
forum) and read its rules about self-promotion; some forbid it outright. Written so it can be cut down: the first
two paragraphs are enough on a place with a short-post culture. The name question in `docs/launch/CHECKLIST.md` comes
before posting. The map of claim to file is in `docs/launch/posts/README.md`.

## Title

```
I made a local game that teaches Redis through incidents; looking for corrections from people who run it
```

## Text

I have been building a game that teaches Redis to backend developers who have never used it, and I would like people
who run Redis in production to read the lessons and tell me what is wrong.

The setup: you are the backend developer of a fantasy cricket app. Each chapter opens with a chat thread that is the
incident ("the stats page takes four seconds", "Teja restarted Redis to fix a warning; the leaderboard is gone"), and
each level is one thing to do about it on a real `redis:8` container with a real Postgres behind it. 96 levels in
eight chapters. What it covers, as the chapter list in the README has it: keys, hashes, lists, sets, sorted sets,
streams and consumer groups; cache-aside with invalidation and stampede protection; sessions; fixed-window, token
bucket and sliding-window rate limiting; leaderboards; pub/sub and why it forgets; job queues with reclaim; locks and
their limits; six on-call scenarios (a `KEYS` cron, a big hash, a Lua loop that freezes the server, a client per
request, keys without TTLs); persistence (RDB and AOF); a replica, three Sentinels, a six-node cluster; ACLs.

How it checks you: by running things, not by reading your code. Your function runs on a sandboxed runner, under
concurrency when the lesson is a race; traffic runs against the app with your code in its slot and is compared with
a baseline the game recorded with your code off; Redis is read back with an allowlist of read-only commands.
"Works, but wrong" is a verdict of its own.

Where the Redis facts come from, and where I would like you to look hardest: every fact in a lesson is supposed to
trace to the official docs through `docs/redis-docs-digest.md` (fetched from redis.io/docs/latest on 2026-11-01), or
be labelled as measured on this stack, or be marked "not verified" in the handoff note of the task that wrote it. The
digest records where the docs contradict themselves. Chapter 5 (persistence, replica, Sentinel, cluster) is the part
hardest to test on one laptop: it needs extra containers, and some of its levels were played by hand rather than
graded by the harness (`docs/BUILD.md`, the C5 row). The "why this is wrong in production" explanations are judgement,
not documentation, and are the other place to look.

What I would like back: anything a lesson states that is wrong, out of date, or too strong; any level whose
"reference" answer you would not accept in a code review. Issues on the repository are best
(https://github.com/PUNEETRKRAJPUT/Redis-Quest/issues); a reply here works too.

Practical: Apple Silicon Mac, 16 GB, Docker Desktop with 8 GB; no Windows, Intel or Linux. Local only, MIT licensed.
Redis 8 and Redis Insight are pulled as Docker images and run only on your machine (their licences are in the README).
Nobody except me has played it yet, so expect rough edges.

Redis Quest is an independent project and is not affiliated with or endorsed by Redis.
