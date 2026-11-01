# F-10: the two missing show-me components

**Goal.** `stats_latency_panel` (level 2.1, in the tester scope) and `otp_limiter_panel` (Chapter 3)
render as "unknown component" today. Implement both in the existing show-me style.

**Files owned.** `ui/src/` (the two components, their registration, tests), `ui/e2e/` only if an
assertion is added, `scripts/check/F-10.sh`.

**Must not touch.** levels, engine, app, packages.

**Design.**
- `stats_latency_panel`: shows the stats route's live p50/p99/requests per second and Postgres
  queries per second from the engine's `GET /api/metrics` (and the `metrics.tick` WebSocket event the
  Metrics panel already consumes), as a small sparkline plus the current numbers, with a one-line
  caption "the page is slow because every request asks Postgres". Keys from `show_me.keys` are
  listed beneath as the cache keys that do not exist yet (they will after 2.2).
- `otp_limiter_panel`: for each key in `show_me.keys`, shows the key's type and value (hash fields
  for a token bucket, the count and TTL for a fixed window, the member count for a sorted-set log)
  through the same read path the other components use, refreshing every second, with an
  allowed/denied tally if the engine's metrics expose the `/app/limits/ping` route (count and 429s).
- Both handle "no data yet" gracefully and follow the dark/light theming of the other components.

**Check.** `scripts/check/F-10.sh`: ui build, lint, vitest with unit tests for both components on
sample data; the `#/showme` gallery renders both without the unknown-component fallback (Playwright
against project `quest-p10` with `.env.p10`, then `down -v`).

**Handoff.** `docs/handoffs/F-10.md`.

**Model.** sonnet
