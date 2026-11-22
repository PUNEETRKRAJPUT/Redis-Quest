---
title: "Add a unit test for the progress mirror (Mirror.status and write ordering)"
labels: good first issue, tests, engine
---

**What.** `engine/src/mirror.ts` keeps `game:player:<id>` and `game:progress` in Redis in step with the save file. No test imports it (`grep -rn "from '../src/mirror" engine/test` is empty), although `status()` decides whether the game offers to restore a flushed save.

**Where to look.**
- `engine/src/mirror.ts`: `write` (queued so writes land in order), `writeStrict`, `setGift`, and `status`, which compares the hash in Redis with the statuses in the file.
- `engine/src/redis.ts`: `RedisManager` has `send` and `transaction`; a test only needs a small fake with those two methods.
- `engine/test/progress.test.ts`: how the progress file is built in a test.

**Done when** `engine/test/mirror.test.ts` checks: `status` reports `present: false` when the hash is empty; `inSync: true` when every level status matches; `inSync: false` when one status differs or the player hash is missing; `write` resolves `false` (and does not throw) when the fake's `transaction` rejects; two `write` calls reach the fake in the order they were made.

**Notes.** The Redis commands `status` sends are `HGETALL game:progress` and `EXISTS game:player:<id>`; assert on those argument arrays.
