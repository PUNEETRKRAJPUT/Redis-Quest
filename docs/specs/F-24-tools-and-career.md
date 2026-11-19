# F-24: the tools pages and the career page

Shared rules: `docs/specs/_wave2-common.md`. Read it first.

## Goal
Nothing in the game may still look like the old UI. Rebuild the remaining screens on the design system.

## Build
1. **Editor** (`/editor` and the editor tab in a level): file tree and tabs restyled; a Monaco theme built
   from the design tokens (night background, amber cursor and selection accents, readable syntax colours);
   save state shown clearly (the `Save` button keeps its role and name; Cmd+S still saves).
2. **Logs** (`/logs`): a broadcast-style feed: service tabs (keep `role="tab"` and the service names),
   follow-tail toggle, error lines marked, a quick text filter. Thousands of lines must stay smooth.
3. **Metrics** (`/metrics`): scoreboard tiles for the live numbers (`metrics`, `metric-p99` test ids kept)
   with small sparklines from the store's ticks; no chart library.
4. **Target switch** restyled, same behaviour and wording.
5. **What you built** (`/built`), the story and the impact log: one "career" page: a player card (name,
   rank from `src/game/rank.ts`, XP, caps count, jersey colour if `src/onboarding/profile.ts` exists),
   what was built per chapter, the impact log as a timeline with its measured numbers, and the existing
   portfolio export action unchanged.

## Files you own
`ui/src/panels/{EditorPanel,LogsPanel,MetricsPanel,TargetSwitch,MonacoEditor}.tsx`,
`ui/src/screens/{Built,Story,ImpactLog}.tsx`, `ui/src/impact.ts`, `ui/src/career/**`,
`ui/src/app/{editor,logs,metrics,built}/**`, the existing tests
`ui/test/{portfolio,targetSwitch,insightLink}.test.*`, new `ui/test/tools*.test.ts(x)`,
`scripts/check/F-24.sh`, `docs/handoffs/F-24.md`.

## Keep working
Every test id and role these screens expose today, the editor's save and reload behaviour, the target switch's
strict mode and messages, the portfolio write.
