# D-04: the phone

Rules for every day task: `docs/specs/_days-common.md`. Branch: `day-04-the-phone`.

## Goal
The player is building the backend of a fantasy cricket app. Show them the app itself, in a phone frame,
answered by their own code, so a slow page is a spinner they sit through and a fix is something they feel.

## Build
1. **Read the app first**: `app/src/routes.ts`, `app/src/slots/` and how a request runs a learner slot or the
   built-in version (`docs/handoffs/` A-01 to A-05, E-01). Pick the four or five routes that make a believable
   app screen each and that exist today (player stats, fixtures, a leaderboard, the live ticker status, the
   wallet or a contest): name them in the handoff with the level that builds each.
2. **A request trace in the app.** When a request carries `x-quest-trace: 1`, the app records, for that
   request only, every Redis command and database query it made (name, start offset, duration, and whether
   learner code or the built-in version ran) and returns it in a size-capped response header. No header, no
   cost. Extend the per-request counting that already exists; do not add a second mechanism. Unit tests.
3. **The phone** (`ui/src/features/phone/`, route `/phone`, and a "Phone" tab in the level workbench): a phone
   frame with one screen per chosen route and a tab bar. Every screen calls the real route through the proxy.
   A spinner shows for as long as the request takes; an error is shown as the app would show it, with the
   status. A strip under the frame shows the last request: total time, and the trace as a waterfall, one bar per
   Redis command or query, so ten round trips look like ten bars and a pipeline like one. A badge says whether
   the route ran the player's code or the built-in version. "Refresh" and "Refresh 20 times" buttons; the
   latter shows the spread, not just the last number.
4. Turn the feature on in `ui/src/features/phone/entry.ts`.

## Files you own
`app/src/**` for the trace (smallest change that works), `app/test/trace*.test.ts`,
`ui/src/features/phone/**`, `ui/src/app/phone/**`, the one new tab in `ui/src/level/Workbench.tsx`,
`engine/src/features/phone.ts` only if you need it, tests, `scripts/check/D-04.sh`, `docs/handoffs/D-04.md`.

## How it will be verified later
A running stack on chapter 2's stats level: the spinner before the cache and after, and the waterfall for one
request with learner code on and off.
