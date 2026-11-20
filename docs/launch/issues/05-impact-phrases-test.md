---
title: "Test the UI copy of metricPhrases with the same cases as the engine copy"
labels: good first issue, tests, ui
---

**What.** The phrases that describe a traffic check ("p99 30 ms under the check's load", "98.7% of requests made no Postgres call") exist twice: `metricPhrases` in `engine/src/portfolio.ts` (written into `workspace/PORTFOLIO.md`) and in `ui/src/impact.ts` (shown on the "What you built" page). The comment at the top of `ui/src/impact.ts` says the two must never disagree. The engine copy has a test (`engine/test/pool.test.ts`, "metricPhrases only says what the numbers allow"); `grep -rn metricPhrases ui/test` finds none for the UI copy.

**Where to look.**
- `engine/test/pool.test.ts` around the `metricPhrases` test: the inputs and the expected strings.
- `ui/src/impact.ts`: `metricPhrases`, `small`, `ms`, `group`.
- `ui/test/panels.test.ts` and `ui/test/insightLink.test.ts` for how UI unit tests are laid out.

**Done when** `ui/test/impact.test.ts` runs the same inputs through the UI function and expects the same strings as the engine test. If you find a case where they differ, that is the bug: say so in the pull request instead of changing either side silently.
