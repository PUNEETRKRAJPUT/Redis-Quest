# F-UI handoff: three small UI fixes

## F-06 terminal scroll jump
- Reproduced in Playwright: with the xterm focused and a full-page screenshot taken, a real `click()` on a stage header further down did not open it (page scrollY jumped back, for example 2438 -> 1962, between mousedown and mouseup, so the click landed elsewhere). With `dispatchEvent('click')` removed, the first run failed at stage 7 in level 1.
- Root cause (what I could establish): the jump is native Chrome behaviour, a pending "reveal the focused editable" for xterm's helper textarea, applied on the next pointer press (armed here by Playwright's full-page screenshot resizing the viewport; a real window resize is the equivalent). Not caused by xterm code or app JS (no scrollTo/scrollIntoView/focus/scrollTop call fires; checked by patching them). I tried `overflow-anchor: none` and moving the textarea: no effect (an injected style tag also changes the outcome, so quick CSS experiments are unreliable). Not verified in other browsers.
- Fix: `ui/src/panels/TerminalPanel.tsx` pins window scroll for the length of any pointer press that starts outside the terminal while the terminal textarea is focused (restores scroll on scroll/focusout/focusin/mouseup/pointerup/click, released on pointerup or 1.5 s).
- Test: `openStage` now uses a normal `click()`, and a new assertion in level 2 (after the full-page screenshot with the terminal focused) checks `window.scrollY` is unchanged (+-1 px) after clicking the stage 6 header.

## F-07 Insight link
- Path taken: no existing endpoint exposes `INSIGHT_PORT` (`/health`, `/api/progress`, `/api/target`, `/api/chapters` checked; only the level templating sees it in `engine/src/config.ts`). Nothing added to the engine.
- `ui/src/screens/Built.tsx` `insightLink()`: use `insightUrl` from `GET /health` if the engine ever serves it (http/https only), else `http://<window.location.hostname>:<localStorage quest.insightPort or 5540>/`. `Health` type got an optional `insightUrl`.
- Engine field requested: `GET /health` should add `insightUrl` (for example `http://localhost:${INSIGHT_PORT}/`). Until then a non-default INSIGHT_PORT still links to 5540 unless `quest.insightPort` is set.
- Tests: `ui/test/insightLink.test.ts` (vitest) and an e2e assertion on `data-testid="insight-link"`.

## F-08
`ALLOW_DEV_COMPLETE_FALLBACK = false` in `ui/e2e/chapter0.e2e.ts`. All five levels passed with verdict `right` from the real verifier (P0-09 in the tree). The script fails if the NOTE line ever appears.

## Files
`ui/src/panels/TerminalPanel.tsx`, `ui/src/screens/Built.tsx`, `ui/src/types.ts`, `ui/e2e/chapter0.e2e.ts`, `ui/test/insightLink.test.ts`, `scripts/check/F-UI.sh` (copy of the P0-10 flow, plus checks for the three fixes). Stack: compose project quest-p10 only, torn down with `down -v`.

## Check output (`scripts/check/F-UI.sh`, exit 0)
```
== playwright: Chapter 0 end to end against http://127.0.0.1:3300
      Version 1.64.1

Running 1 test using 1 worker

  ✓  1 e2e/chapter0.e2e.ts:90:1 › Chapter 0 end to end: welcome, map, five levels, built, tools (7.6s)

  1 passed (8.3s)
PASS  playwright: Chapter 0 played end to end

== fix assertions present
PASS  F-08: dev-complete fallback disabled
PASS  F-06: scroll position assertion present
PASS  F-06: e2e clicks stages normally

== screenshots
PASS  24 screenshots in ui/e2e/screenshots/
      01-welcome.png
      02-map-start.png
      03-level1-scenario.png
      04-level1-exists.png
      05-level1-brainstorm.png
      06-level1-build.png
      07-ch0-01-bhai-it-works-on-my-laptop-verify-right.png
      08-level1-passed.png
      09-level2-terminal.png
      10-ch0-02-say-hello-verify-right.png
      11-level3-terminal.png
      12-ch0-03-find-your-save-file-verify-right.png
      13-ch0-04-the-second-window-verify-right.png
      14-ch0-05-roommate-ran-down-verify-right.png
      15-map-done.png
      16-built.png
      17-terminal.png
      18-editor.png
      19-logs.png
      20-metrics.png
      21-showme-gallery.png
      22-mirror-banner.png
      23-map-dark.png
      24-level-dark.png

== cleanup: docker compose -p quest-p10 down -v

F-UI OK
```

## git status --short
```
 M ui/e2e/chapter0.e2e.ts
 M ui/src/panels/TerminalPanel.tsx
 M ui/src/screens/Built.tsx
 M ui/src/types.ts
?? docs/handoffs/F-UI.md
?? scripts/check/F-UI.sh
?? ui/test/insightLink.test.ts
```
