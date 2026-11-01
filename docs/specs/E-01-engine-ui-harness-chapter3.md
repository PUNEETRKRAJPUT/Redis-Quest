# E-01: engine, UI and harness plumbing Chapter 3 needs

**Goal.** Three things Chapter 3 cannot be written without: the engine emits `service_scaled` when the number
of live app instances changes (the "you are not alone" level), the learner can put their own code into the app
from the game page (every "try it" in Chapters 2 and 3 silently ran the baseline until now), and the grading
harness can grade levels whose verifiers wait for a pub/sub message, a scale event or the app's `ticker_gap` event.

**Depends on.** nothing (A-02 runs in parallel and owns `app/`; it will post `ticker_gap` to the existing
public `POST /api/events` route, so nothing here is needed for that).

**Files owned.**
- `engine/src/metrics.ts`, `engine/src/server.ts` (the two routes named below and the emitter wiring only),
  `engine/test/` (new or extended tests only)
- `ui/src/` (the toggle in the Build beat, `api.ts`, `types.ts`, `store.ts` as needed), `ui/test/`
- `scripts/grade/grade.mjs`, `docs/grading.md` (one new section)
- `scripts/check/E-01.sh`, `.env.e01` (gitignored; ports below)
- `docs/handoffs/E-01.md`

**Must not touch.** `app/` (A-02 is editing it right now), `engine/src/verify/slots.ts` (A-02 owns it this
round), `packages/`, `runner/`, `levels/`, `scenarios/`, `docker-compose.yml`, `docker/`, other checks,
`docs/BUILD.md`. Do not run the default compose project or `quest-a02`; use `quest-e01`.

**Interfaces to honour.** Event shape `bus.emit('level.event', { kind, name?, data })` (`engine/src/events.ts`);
`eventMatches` in `engine/src/verify/events.ts` looks a `match` key up at the top level of the event, then
inside `data`; `levelSlots(verify)` in `engine/src/verify/index.ts`; `PUT /api/slots` semantics in
`server.ts`; the metrics push body in `docs/handoffs/P0-07.md`; the harness's current event rules in
`uiActions` (`scripts/grade/grade.mjs`) and its WebSocket progress handling; `docs/handoffs/F-12.md` for how the
UI level screen is laid out (the Build beat is beat 5).

**Work.**

1. **`service_scaled` emitter.** In `MetricsStore` (`engine/src/metrics.ts`) an instance is *live* when its
   newest sample is at most 5 s old. Whenever the live count changes (on a push, and on a 2 s timer the server
   starts so a vanished instance is noticed without waiting for the next push), call a listener
   `onScale(prev: number, now: number, ids: string[])`. `server.ts` wires it to
   `bus.emit('level.event', { kind: 'service_scaled', data: { service: 'app', instances: now, previous: prev, ids } })`.
   A level matches it with `kind: service_scaled, match: { service: app, instances: 2 }` (numbers compare with
   `looseEqual`, check it). The 0 to 1 transition at boot emits too; that is fine. Unit test with fake pushes
   and a fake clock: 1 to 2 emits once, a second push from the same id does not, going quiet for 6 s emits 2 to 1.

2. **"Run my code in the app".** New route `POST /api/levels/:id/slots` with body `{ active: boolean }`.
   The level must be `in_progress` or `passed` (`activeEntry`, like brainstorm). `own = levelSlots(verify)`;
   `true` sets the active list to the union of the current list and `own`; `false` removes `own`. Persist and
   apply exactly as `PUT /api/slots` does (same `runtime.activeSlots` and `commit('slots', ...)`). Answer
   `409 verify_in_progress` while a verification runs for the player (`verifier.begin` throws `VerifyBusyError`
   today; expose a non-throwing `isRunning(playerId)` or reuse the throw). Response `{ active: string[], own: string[] }`.
   `GET /api/levels/:id` gains `slots: { own: string[], active: boolean }` (`active` is true when every own slot
   is in the current list; `own: []` and `active: false` on levels without slots). Route test in `engine/test/`.

3. **UI toggle.** On a level with `slots.own.length > 0`, the Build beat (beat 5) shows a switch
   `data-testid="slot-toggle"` labelled "Run my code in the app", with the state from the level payload, and
   one line under it: when on, "Your code answers /app requests on every app instance"; when off, "The app runs
   its built-in version; your code only runs in the verifier". A note in small text: "A loop that never finishes
   freezes an app instance; `docker compose restart app` brings it back." Clicking calls the route and reloads
   the level. Reload the level also when the WebSocket carries `verify_finished` (the traffic verifier switches
   slots and puts them back, so the switch must not lie afterwards). A 409 shows "Wait for the verifier to
   finish" next to the switch. Unit test in `ui/test/` (render on, click, request body, render off). Do not
   change the e2e spec list (`scripts/check/F-UI.sh` is pinned to `e2e/chapter0.e2e.ts`); add no e2e.

4. **Harness: events that happen during the wait.** Extend `scripts/grade/grade.mjs` so a solution declared
   `right` or `works_but_wrong` ("good") gets the live event its level waits for, and a solution declared `wrong`
   gets nothing (the same rule `answer` and `quiz` already follow). Three rules:
   - `service_scaled` with `match.instances: N` (N is 2 in Chapter 3): before calling verify, POST
     `/internal/metrics` (it is reachable through the proxy; the engine serves it) once a second for 3 s with a
     second instance id `grader-instance-2` and the push body from `docs/handoffs/P0-07.md` (`routes: {}`,
     `windowMs: 1000`, `at` on a second boundary). The real emitter then fires (do not post the event yourself).
     Note in the handoff whether the engine saw it while the real app instance is also pushing (count 1 to 2).
   - `channel_message` with `match.channel`: the engine only sees a message while it is waiting (it SUBSCRIBEs
     during the check), so the harness must act *during* verify: start verify without awaiting it, watch the
     WebSocket progress events the harness already receives, and when `verify_check_started` arrives for that
     verifier's index, run `PUBLISH <channel> <message>` through `/api/cli` once a second until that check
     finishes (cap 10). Message: `{"matchId":"m-041","seq":1,"over":1,"ball":1,"runs":4,"batter":"p-028"}`
     unless the level's verifier carries `match.message`, which then wins. Keep the ordinary flow for levels
     without such verifiers (no behaviour change for Chapters 0 to 2; `scripts/check/G-01.sh` must stay green).
   - custom `ticker_gap`: the app's ticker worker (A-02) posts it when a subscriber sees a sequence gap after
     `POST /app/ticker/resubscribe`. Before verify, for a good solution: `PUBLISH score:match:m-041 {"seq":1,...}`
     via `/api/cli`; POST `/app/ticker/resubscribe` `{ "matchId": "m-041", "pauseMs": 1000 }` (through the same
     base URL, not awaited); sleep 200 ms; PUBLISH seq 2 and seq 3; await the resubscribe response; PUBLISH seq 4.
     Until A-02 lands this route answers 404: the harness must then print `NOTE ticker_gap: /app/ticker/resubscribe
     not available (A-02 not merged)` and carry on (the level will show as a mismatch, which is correct).
   Document the three rules in `docs/grading.md` under "Events the harness produces".

**Acceptance check.** `scripts/check/E-01.sh`, bash 3.2, compose project `quest-e01` with `.env.e01`
(`PROXY_PORT=3600 REDIS_PORT=6396 PG_PORT=5438 INSIGHT_PORT=5546 ENGINE_DEV=1`), scratch `QUEST_LEVELS_DIR`
holding a copy of `levels/_examples/example-cli`, `example-code` and a scratch chapter the check writes
(`scratch-e01`, three levels: an `ops` level with `event service_scaled instances 2` and a `.redis` reference
`PING`; a `code` level on slot `cache.getPlayerStats` whose verify is one `behavior` (call `p-028`, sideEffect
`TYPE cache:player:p-028 equals hash`) plus `event channel_message` on channel `score:match:test` with
`timeoutMs: 20000`, reference = a `.js` that writes the hash then `PUBLISH`es on that channel, wrong = a copy that
does not publish; keep every level valid for `levels:validate`), scratch progress and workspace; no insight;
`down -v` on exit; must:
- start the stack with `--scale app=2` and see, within 15 s, a `service_scaled` event with `instances: 2` in
  `GET /api/events`; scale to 1 and see `instances: 1` within 15 s (real emitter, real instances);
- start the example code level, `POST /api/levels/<id>/slots {active:true}` → 200 and `GET /api/slots` lists the
  slot, `/app/health` on the proxy shows it active within 4 s; `{active:false}` removes it; `GET /api/levels/<id>`
  shows `slots.active` true then false;
- run `scripts/grade/grade.sh --engine http://127.0.0.1:3600 scratch-e01` and get the `service_scaled` reference
  `PASS` (fake pushes), the channel reference `PASS`, the no-publish wrong `PASS` (engine said wrong);
- run `scripts/grade/grade.sh` on `levels/_examples/example-cli` and `example-code` and get no MISMATCH (regression);
- engine vitest, ui vitest, `pnpm -r lint`, `pnpm format:check` green (format only your own files);
- exit 0 and print each thing it verified.

**Handoff complete when.** the check passes on this Mac; `docs/handoffs/E-01.md` holds the exact event payload
shapes, the route contract, the harness rules as implemented, what you could not verify (the `ticker_gap` dance
until A-02 is in), and the full check output; nothing outside "Files owned" changed.

**Model.** sonnet
