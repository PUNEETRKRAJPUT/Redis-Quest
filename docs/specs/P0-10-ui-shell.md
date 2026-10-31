# P0-10: UI shell

> DRAFT until the P0-06 handoff fixes the engine API; component names below are the intent.

**Goal.** The game the learner sees: chapter map, the seven-beat level view, the in-browser Redis
terminal, the code editor, the logs and metrics panels, and the "show me" slot. Chapter 0 must be
playable end to end in a browser with real content, and the design must be good enough that a beginner
does not need the README.

**Depends on.** P0-06, P0-09 (verify endpoint), Chapter 0 content (task C0; stub levels from
`levels/_examples` are acceptable for the check if C0 is not done)

**Files owned.** `ui/` (everything), `scripts/check/P0-10.sh`, `engine/src/static.ts` only if serving
needs a change (say so in the handoff).

**Must not touch.** `engine/` otherwise, `app/`, `runner/`, `packages/`, `levels/`, `docker/`.

**Interfaces to honour.**
- Engine API and WebSocket events exactly as `docs/handoffs/P0-06.md` documents them. No other backend.
- Load `artifact-design`-grade care is not available here; follow these rules instead: one accent colour
  from the fiction (the league's colour in `fiction/league.json` if present, otherwise a deep saffron),
  system font stack, dark and light via `prefers-color-scheme`, 16 px side gutters, keyboard reachable,
  no horizontal scroll at 1280 px. No emoji as UI icons; use inline SVG.
- Screens: **Welcome** (name prompt → `POST /api/player`), **Chapter map** (chapters as a path, levels
  with status, XP and badges), **Level** (the seven beats as collapsible stages in order: scenario thread
  rendered as a chat; what already exists with the live pain panel; brainstorm with options + one-line
  text; teach markdown; build area that depends on `mode`; verify button with live check progress; the
  ideal-way panel that unlocks on pass, after three failed attempts, or on request), **Terminal**
  (xterm.js, history, sends to `/api/cli`, renders replies like redis-cli, flags dangerous commands
  inline), **Editor** (Monaco, edits `workspace/` files through an engine endpoint if P0-06 provides one,
  else read-only view with "open in VS Code" instructions and file path), **Logs** (tabs per service,
  tail from WebSocket), **Metrics** (p50/p99/rps/db queries/redis commands sparkline from
  `metrics.tick`), **What you built** (passed levels with their `show_me` component and a Redis Insight
  deep link), **Show-me components** for Milestone 1: `kv_card`, `hash_card`, `list_feed`,
  `set_chips`, `leaderboard_panel`, `ttl_timer`, `bitmap_streak`, `hll_counter`, `geo_map` (simple SVG
  dots), `stream_log`, `json_tree`, `cache_stats`.
- State: React 19, a small store (zustand or context), WebSocket client with reconnect; no SSR.
- Markdown rendering with syntax highlighting for `redis` and `js` fences; links to `redis.io/docs` open
  in a new tab.
- Playwright (`ui/e2e/`): plays Chapter 0 end to end against the real stack.

**Work.** Build the above; `scripts/check/P0-10.sh`: `pnpm --filter @quest/ui build`, `docker compose up
-d --build` (full stack), Playwright run of Chapter 0 (welcome → map → each level → verify → pass), screenshot
each screen into `ui/e2e/screenshots/` (gitignored), `docker compose down`.

**Acceptance check.** `scripts/check/P0-10.sh` exits 0.

**Handoff complete when.** check passes; `docs/handoffs/P0-10.md` written with the check output, the
show-me component contract (props each expects), and known rough edges; no files outside "Files owned"
changed.

**Model.** sonnet
