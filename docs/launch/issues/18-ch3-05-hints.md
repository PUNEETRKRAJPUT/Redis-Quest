---
title: "Write hints for the one level that has none"
labels: good first issue, levels
---

**What.** 95 of the 96 levels have a `hints` list; `ch3-05-fail-open-or-fail-closed` has none (checked by loading every level with the game's loader). It is a `decision` level: three places where code must choose between failing open and failing closed when Redis is unreachable. A learner who is stuck has nothing to open.

**Where to look.**
- `levels/ch3-compete-and-talk/05-fail-open-or-fail-closed.yaml`: the story, the quiz, and the `explanation` fields that already say why each answer is right.
- `levels/README.md`: `hints` are revealed one at a time, in order; the first should nudge, the last should nearly say it.
- A neighbouring decision level, for the tone (`levels/ch3-compete-and-talk/chapter.yaml` lists them).

**Done when** the level has two or three hints that point at the question to ask ("what does this check protect, and what does it cost to be wrong in each direction?") without naming the answers, and `pnpm --filter @quest/shared levels:validate levels` is clean.

**Notes.** Do not add a Redis fact the level does not already state. Tone and naming rules are in `docs/fiction.md`.
