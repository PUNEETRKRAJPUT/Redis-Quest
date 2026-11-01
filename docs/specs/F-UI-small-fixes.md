# F-UI: three small UI fixes (F-06, F-07, F-08)

**Goal.** Fix the three rough edges the UI handoff listed, with tests.

**Files owned.** `ui/` only, plus `scripts/check/F-UI.sh`.

**Work.**
- F-06: clicking away from a focused xterm terminal makes the page scroll jump. Reproduce in Playwright,
  fix for real (likely xterm's textarea focus/blur scrolling; `scrollIntoView` suppression or container
  `overflow-anchor`), keep the e2e clicking stages normally instead of `dispatchEvent('click')`.
- F-07: the Redis Insight link must use the configured port: the engine already serves its env; if
  `GET /health` or `GET /api/progress` does not expose `INSIGHT_PORT`, read `window.location.hostname`
  and a `VITE_INSIGHT_PORT`-free approach: ask the engine via an existing endpoint only; if none exposes
  it, add nothing to the engine (not owned) and instead make the link relative to a documented
  `insightUrl` field you request in the handoff, defaulting to 5540. State clearly in the handoff which
  path you took.
- F-08: set `ALLOW_DEV_COMPLETE_FALLBACK = false` in the e2e now that verify works; the e2e must pass
  through real verification only.

**Isolation.** Compose project `quest-p10` with `.env.p10` as P0-10 did (3300/6393/5435/5543), full
stack; `docker compose -p quest-p10 down -v` at the end.

**Check.** `scripts/check/F-UI.sh`: ui build, lint, vitest, then the Chapter 0 Playwright run with the
fallback disabled and a new e2e assertion that the page scroll position does not change when focus
leaves the terminal.

**Handoff.** `docs/handoffs/F-UI.md`.

**Model.** sonnet
