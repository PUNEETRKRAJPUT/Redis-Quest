---
title: "Level idea: expire one field of a hash with HEXPIRE"
labels: levels, help wanted
---

**What.** Chapter 1 level 3 keeps a user as one hash (`levels/ch1-keyspace/solutions/03-reference.redis`). Since Redis 7.4 a single hash field can have its own expiry (`HEXPIRE`, `HTTL`). The digest lists them and flags a conflict: "this page says hash fields can't have an associated time to live, which is outdated ... Flag if the course teaches both" (`docs/redis-docs-digest.md` lines 105 and 372). No level teaches field expiry (`grep -rli hexpire levels` is empty).

**Where to look.**
- `docs/redis-docs-digest.md` lines 105 and 372.
- `levels/ch1-keyspace/03-the-profile.yaml`: its teach text about hashes; a new level must not contradict it.
- `levels/README.md` field `min_redis_version` (a quoted version such as `"8.4"`) for commands that need a newer server; the stack runs `redis:8`.

**Done when** a draft level sets a short expiry on one field (for example a "welcome banner seen" flag on the profile hash) and checks with `HTTL` that the other fields have none; reference and a wrong solution (expiring the whole key) pass `levels:validate`. Check the exact reply shapes against a real Redis 8 before you write the verifier. Keep the draft outside `levels/` until the maintainer decides where it lands.
