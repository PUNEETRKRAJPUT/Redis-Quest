---
title: "Level idea: take the most urgent job with ZPOPMIN"
labels: levels, help wanted
---

**What.** `levels/ch4-work-in-the-background/09-later-and-more-important.yaml` moves due jobs out of a sorted set with a Lua script that does `ZRANGE ... BYSCORE LIMIT`, then `ZREM` and `LPUSH` (`solutions/09-reference.js`). Taking the lowest-scored member atomically is a single command, `ZPOPMIN` (and `BZPOPMIN` to wait for one), which the digest lists (`docs/redis-docs-digest.md` line 112) but no level uses.

**Where to look.**
- The level and its reference solution named above, for the scoring convention already taught.
- `docs/redis-docs-digest.md` line 112: it names the commands only. Read the official sorted-set pages, add the facts you need (what is returned, what happens on an empty set) to the digest.
- `levels/README.md`: "Field reference" and the rule that `code` levels need a `behavior` or `traffic` verifier.

**Done when** a draft level (a `cli` level is enough to start) pops the most urgent of a few jobs and shows why two workers doing `ZRANGE` then `ZREM` can take the same one; reference, wrong solution and verifier pass `levels:validate`. Draft it outside `levels/`; the maintainer decides where it lands.
