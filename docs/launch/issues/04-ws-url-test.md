---
title: "Add a unit test for wsUrl in the UI"
labels: good first issue, tests, ui
---

**What.** `wsUrl` in `ui/src/ws.ts` builds the WebSocket address: same origin in production, and a direct connection to the stack's proxy port in development, where `next dev` cannot proxy a socket. It takes a `Location`-like argument on purpose so it can be tested, and `grep -rn wsUrl ui/test` finds no test.

**Where to look.**
- `ui/src/ws.ts`: `wsUrl(loc)`, which reads `process.env.NEXT_PUBLIC_QUEST_WS_PORT`.
- `ui/test/insightLink.test.ts`: the same style of small pure-function test.

**Done when** `ui/test/ws.test.ts` checks: `https:` gives `wss://` and `http:` gives `ws://`; with the env variable unset the host is `loc.host` and the path is `/ws`; with it set the host is `loc.hostname` plus that port. Use `vi.stubEnv` and restore it after each test.

**Notes.** Run with `pnpm --filter @quest/ui exec vitest run test/ws.test.ts`.
