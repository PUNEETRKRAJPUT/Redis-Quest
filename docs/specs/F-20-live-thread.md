# F-20: chapter threads that feel like a real chat

Shared rules: `docs/specs/_wave2-common.md`. Read it first.

## Goal
Every chapter opens with a chat thread that is the incident. Make it arrive like a real group chat.

## Build
1. **`Thread`** keeps its exports and props (`Thread({ messages, label })`, `nameOf`) and gains optional props
   for the new behaviour, so existing callers keep working unchanged.
2. **Look:** a phone-style chat column: sender avatar (initials on a colour derived from the sender), name,
   time, bubbles grouped by sender, the player's own side distinct if a message is from the player.
3. **Arrival:** messages appear one at a time with a typing indicator before each (delay scales with the
   message length, capped), `msg` sound per message, auto-scroll that never fights the user's scroll.
   "Show all" (and Escape) reveals everything at once. A thread already seen (remember per thread in
   `localStorage`, keyed by a hash of its content) opens fully revealed with a "Replay" action.
   Reduced motion: everything at once, no typing indicator.
4. **Accessible:** it is a list of messages with sender and time readable by a screen reader, announced
   politely as they arrive (`aria-live`), and never traps focus.

## Files you own
`ui/src/level/Thread.tsx`, `ui/src/thread/**`, `ui/test/thread*.test.ts(x)`, `scripts/check/F-20.sh`,
`docs/handoffs/F-20.md`.

## Note
Find every caller of `Thread` (the map and the level screen) and check both still render; do not edit them.
