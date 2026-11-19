# F-21: the level as a match view

Shared rules: `docs/specs/_wave2-common.md`. Read it first. This is the largest screen: read all of
`ui/src/screens/Level.tsx` and both e2e files before you design anything.

## Goal
Playing a level feels like being at the crease: the brief on one side, your workspace in the middle, the
scoreboard of checks on the other, and a verdict that lands like a third-umpire decision.

## Build
1. **Layout:** resizable panes (`react-resizable-panels`, sizes remembered in `localStorage`): the brief
   (the existing stages in order, as a vertical timeline that keeps each stage's open and close behaviour and
   its `stage-<n>` test id), the workspace (the existing `Workbench` tabs, restyled), and the scoreboard
   (check button, verdict, checks, hints, show-me, the ideal way). A level header with chapter, title, mode,
   XP, status and the interview pills. At 1280 wide nothing is cramped; below that the panes stack.
2. **Decision pending:** pressing the check button (`verify-button`, label stays plain: "Check my work" or the
   current wording) shows a "Decision pending" big-screen overlay while the request runs (at least 700ms so it
   reads, never more than 300ms after the response), then the verdict (`verdict` test id, same copy from
   `VERDICT_COPY`) in the big-screen style. Reduced motion: no overlay, the verdict simply appears.
3. **Checks as a scoreboard:** each check is a row with a clear pass or fail mark, its message, and for a
   failed check the expected and actual values when `details` carries them, in mono. Failing rows first.
4. **A pass is a moment:** `Confetti`, `Floodlights`, `tock`, the XP gain counted up, the badge earned shown
   as a cap, and one obvious next action (`next-level`). A fail plays `out` and puts focus on the first
   failing check. "Works but wrong" is its own, distinct treatment.
5. **Interview mode:** the countdown (`countdown`) as a match clock that turns amber in the last fifth and red
   in overtime; hint purchase confirmation as a proper `Dialog` with the same test ids and wording.
6. **Hints, brainstorm, quiz and answer inputs** restyled on the design system with the same test ids.
7. **Show-me:** pass `interactive={level.status === 'passed'}` to `ShowMe` (the prop already exists and is
   ignored until another task implements it).

## Files you own
`ui/src/screens/Level.tsx`, `ui/src/level/**` except `Thread.tsx`, `ui/src/match/**`,
`ui/src/app/level/**`, the existing tests `ui/test/{interview,runTraffic,slotToggle,diff}.test.*`, new
`ui/test/match*.test.ts(x)`, `scripts/check/F-21.sh`, `docs/handoffs/F-21.md`.

## Keep working
Every test id listed by `grep -rhoE "getByTestId\('[^']+'\)" ui/e2e | sort -u`, the stage order and their
default open state, the brainstorm lock, slot toggle and run-traffic behaviour, the ideal-way unlock rules,
pool and interview flows. On the shared backend use levels that are still unpassed (chapter 2 from its fifth
level) so you do not disturb the passed ones; you may pass a level through its real check to see the
celebration.
