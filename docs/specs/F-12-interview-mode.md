# F-12: interview mode

**Goal.** A level can be a timed blank rebuild: no teach panel, a visible countdown, hints that cost XP,
and the elapsed time recorded. Level 2.11 and every later "blank rebuild" level use it.

**Files owned.** `packages/shared/src/levels/` (additive schema), `levels/README.md` (one section),
`engine/src/` (progress fields, hint cost, timer), `ui/src/` (timer, hidden teach, hint cost prompt),
`levels/_examples/` (one example interview level), `scripts/check/F-12.sh`.

**Must not touch.** app, runner, real chapters' content.

**Design (binding).**
- Schema: optional `interview: { minutes: <int 5..60>, rebuild_of: <level id>, hint_xp_cost: <int,
  default 10> }` on any `code` level. The validator checks `rebuild_of` names an existing level in the
  same chapter or an earlier one (by canonical chapter order), and that `teach` may be empty for such
  levels (make `teach` optional only when `interview` is set).
- Engine: on `start` of an interview level record `interviewStartedAt`; `GET /api/levels/:id` returns
  `interview` plus `remainingMs`; a verify after the deadline still grades but records `overtime: true`
  and the UI shows it; each hint on an interview level subtracts `hint_xp_cost` from XP (never below 0)
  and records `hintsBought`. The ideal-way panel on an interview level links to `rebuild_of`'s solutions.
- UI: countdown in the level header, the Teach stage replaced by a one-line "no teaching here: this is
  the interview", hint button says what it costs and confirms, overtime shown plainly, and on pass a
  line "rebuilt in m:ss" that also appears in "What you built".
- Example level in `levels/_examples/example-interview/` rebuilding `example-code-01-cache-aside`.

**Check.** `scripts/check/F-12.sh`: shared build + tests (schema cases: valid, bad `rebuild_of`, minutes
out of range), engine tests for the timer and hint cost, ui build/lint/vitest, and a Playwright run in
project `quest-p10` (`.env.p10`) that starts the example interview level, buys a hint, sees XP drop, and
sees the countdown; `down -v`.

**Handoff.** `docs/handoffs/F-12.md`.

**Model.** sonnet
