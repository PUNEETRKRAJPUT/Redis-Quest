# F-04 (+ F-09): the ideal-way panel, and insightUrl in /health

**Goal.** The seventh beat works: after a pass, or after three failed attempts, the panel shows the
reference solution with its reasoning and the wrong solutions with their `because`, side by side with
what the learner did; a "reveal anyway" button fetches it on request. Plus the engine exposes the Insight
URL so the UI link follows the configured port.

**Files owned.** `ui/` (panel, store, e2e), `engine/src/health.ts` or wherever `GET /health` is built
(only to add `insightUrl`), `docker-compose.yml` only to pass `INSIGHT_PORT` into the engine's
environment (a one-line addition inside the P0-06 engine marker block), `scripts/check/F-04.sh`.

**Interfaces.** `docs/handoffs/P0-09.md`: the `ideal` object in the verify response (when allowed) and
`GET /api/levels/:id/ideal` (`allowed`, `reason`, `reference { path, content }`, `wrong [{ path, content,
expect, because }]`, decision levels: correct options and explanations), `idealRevealedAt` in progress.
`docs/handoffs/F-UI.md`: the Insight link reads `insightUrl` from `GET /health` when present.

**Work.**
- Engine: `GET /health` gains `insightUrl: "http://<host>:<INSIGHT_PORT>"` where host is the request's
  hostname and `INSIGHT_PORT` comes from env (default 5540); compose passes `INSIGHT_PORT`.
- UI: the ideal-way stage renders `ideal` from the last verify response; when locked it shows the
  reason and a "Reveal anyway" button that calls the GET endpoint; reference code in a read-only Monaco
  (or highlighted block for `.redis`/`.sh`) beside the learner's current workspace file for `code`
  levels, with a simple diff view (line-level is enough); each wrong solution collapsible with its
  `because`; for decision levels the correct options with explanations. Keep it in the existing design.
- e2e: on one Chapter 0 level, fail verification three times with a wrong answer, assert the panel
  unlocks and shows the reference; on another, pass and assert the panel shows; "reveal anyway" on a
  locked level works.

**Isolation.** Compose project `quest-p10` with `.env.p10` as before (3300/6393/5435/5543); full stack;
`down -v` at the end.

**Check.** `scripts/check/F-04.sh`: ui build, lint, vitest, engine build, the e2e above plus the
existing Chapter 0 run, `GET /health` on the project shows `insightUrl` with port 5543.

**Handoff.** `docs/handoffs/F-04.md`.

**Model.** sonnet
