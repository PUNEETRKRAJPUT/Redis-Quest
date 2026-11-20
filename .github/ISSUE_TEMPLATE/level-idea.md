---
name: Level idea
about: Propose a new level, or a change to one. Please open this before writing the YAML
title: "[level] <one line>"
labels: level-idea
---

**The Redis idea** (the one thing a learner should be able to do or explain afterwards):

**Where it fits** (which chapter, and after or before which level; or "new chapter"):

**The story beat** (what goes wrong in the cricket app, in two or three sentences):

**How a machine could grade it.** A level has to be gradable by the harness (see `docs/grading.md`). Which of
these would it use?

- [ ] Redis commands in the terminal (a `.redis` solution, keys read afterwards)
- [ ] A function the learner writes (behavior check, maybe run many times at once)
- [ ] Traffic against the app, judged against a baseline
- [ ] An event (Redis goes away, a message arrives, a key expires)
- [ ] A quiz or a typed answer
- [ ] None of these: I do not know yet

**The reference solution**, in a sentence or two:

**One wrong solution a learner is likely to write**, and what the verdict should say about it:

**Where the Redis facts come from** (a page of the official docs, or a line in `docs/redis-docs-digest.md`).
Please do not rely on memory:

**Does it need a Compose profile, a real outage, or an ops shell script?** Those levels cannot be graded by
the machine verdict on GitHub and are graded by hand on a Mac.
