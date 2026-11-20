---
title: "docs/TESTING.md says 6 GB of free disk, the preflight demands 10 GB"
labels: good first issue, docs
---

**What.** `docs/TESTING.md` ("What you need") says "About 6 GB of free disk for images and data". `scripts/preflight.sh` (check 7) fails below 10 GB, and the README says the same 10 GB, so a tester with 8 GB free follows the guide and is stopped at the first step.

**Where to look.**
- `docs/TESTING.md` line 19.
- `scripts/preflight.sh` lines 96 to 102, and the README's "What you need" list.
- `docs/TESTER-MESSAGE.md` for any matching number.

**Done when** the tester guide and the invite give the same disk figure as the preflight. Do not change the preflight threshold in this issue. `scripts/check/C-POL.sh` asserts parts of these documents; read it first and keep the phrases it looks for.
