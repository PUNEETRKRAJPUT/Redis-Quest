---
title: "levels/README.md names a chapter directory that does not exist"
labels: good first issue, docs, levels
---

**What.** In `levels/README.md`, section "Layout", the list of chapter directories says `ch4-background`. The real directory is `ch4-work-in-the-background` (see `CANONICAL_CHAPTER_DIRS` in `packages/shared/src/levels/loader.ts`, and `ls levels`). A new level author who creates `levels/ch4-background/` gets a chapter that the canonical order does not know.

**Where to look.**
- `levels/README.md` line 24.
- `packages/shared/src/levels/loader.ts`: `CANONICAL_CHAPTER_DIRS`.

**Done when** the README lists the directory names exactly as `ls levels` shows them. While you are there, read the rest of that "Layout" paragraph against the code and fix anything else that has drifted; list what you changed in the pull request.
