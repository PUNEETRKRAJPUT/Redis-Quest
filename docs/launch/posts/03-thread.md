# Draft: a short thread

Status: draft, not posted. For Mastodon, Bluesky or X; each post is written to stay under 280 characters (the check
at the bottom counts them). Attach the images named in each post; the alt text is in the line below it. If the
project is renamed (see `docs/launch/CHECKLIST.md`) change the name in post 1 and the last post. The map of claim to
file is in `docs/launch/posts/README.md`.

---

**1/7**

Redis Quest: a game that teaches Redis to backend developers by breaking a cricket fantasy app, one night at a time. Real Redis 8, real Postgres, real traffic, all on your Mac. Independent project, not affiliated with or endorsed by Redis.

Image: `docs/img/map.jpg`. Alt: The season map: each chapter a match night with its incident, each level a ball in an over.

**2/7**

You are the backend dev. Each chapter opens as a chat thread: "the stats page is a four-second spinner", "the leaderboard is gone". 8 chapters, 96 levels, from docker compose up to a Sentinel failover and a cluster.

**3/7**

Every level makes you do something real: type commands in a terminal, or write one JavaScript function that the game loads into a running app while it serves.

Image: `docs/img/terminal-target.jpg`. Alt: The terminal with the target switcher: single node, no persistence, replica, Sentinel, cluster.

**4/7**

Nothing is graded by reading your code. Checks run against the live stack: your function under concurrency, traffic compared with a baseline the game recorded itself, Redis read back with read-only commands. "Works, but wrong" is its own verdict.

**5/7**

Some levels are timed rebuilds from a blank file. In the finale the game draws the use case for you, then the interviewer asks what happens when it breaks.

Image: `docs/img/mock-interview.jpg`. Alt: A mock interview: the use case is drawn when you start, the clock runs, the file is blank.

**6/7**

Honest status: a release candidate, and nobody but me has played it yet. I do not know where people get stuck. Needs an Apple Silicon Mac, 16 GB, Docker Desktop. No Windows, Intel or Linux. Local only, MIT.

**7/7**

If you try Chapter 0 and the start of Chapter 1, tell me where you stopped, even for 30 seconds. Code, level catalogue and screenshots: https://github.com/PUNEETRKRAJPUT/Redis-Quest [SITE URL once Pages is on]

---

## Length check

From the repository root; every number printed must be 280 or less (the links count as 23 on most services, so the
last post has room to spare):

```bash
awk '/^\*\*[0-9]\/7\*\*$/ {getline; getline; print length($0), substr($0,1,40)}' docs/launch/posts/03-thread.md
```
