---
title: "workspace/README.md leaves out deps.redisCached"
labels: good first issue, docs
---

**What.** `workspace/README.md` says a learner's function receives three things (`redis`, `db`, `log`) in "What is in `deps`". The code hands over a fourth: `redisCached`, a second client with client-side caching, used by Chapter 5 level 6 (`levels/ch5-survive/06-the-celebrity-again.yaml` tells the learner to destructure it from the deps).

**Where to look.**
- `packages/shared/src/learner/types.ts`: `LearnerDeps` and the comment on `redisCached`, including that its commands are not counted in `redisCommands`.
- `workspace/README.md`: the "three rules" and the table under "What is in deps".
- `levels/ch5-survive/06-the-celebrity-again.yaml`: how the level introduces it.

**Done when** the README table has a row for `redisCached` that says what it is, that it exists from Chapter 5, and that a write should still go through `redis`. Use only what the type comment and the level text already say; do not describe Redis client-side caching beyond that.
