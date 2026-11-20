---
title: "The show-me gallery fills its columns top to bottom, not row by row"
labels: good first issue, ui
---

**What.** The practice gallery lays its panels out with a CSS multi-column layout (`columns-[27rem]` on the `nets-grid` element in `ui/src/screens/ShowMeGallery.tsx`). Panels therefore run down the first column, then the second, so the order a person reads (strings, hashes, lists ...) is broken across the page. The note is in `docs/handoffs/F-23.md`, "Not done": "the gallery's `columns` layout orders panels top to bottom per column, not row by row".

**Where to look.**
- `ui/src/screens/ShowMeGallery.tsx` around the `data-testid="nets-grid"` element.
- `ui/test/showme.test.tsx` and `ui/e2e/` for tests that look for `data-nets` or `nets-grid`; keep those hooks.
- `docs/design/EXPERIENCE.md`: nothing may overflow at 1024 px wide, and visible focus rings are a hard rule.

**Done when** the panels read left to right, then down (a CSS grid, or columns filled in turn), without panels of different heights leaving large gaps, and the existing test ids still resolve. Attach a screenshot at 1280 px and at 1024 px wide to the pull request.
