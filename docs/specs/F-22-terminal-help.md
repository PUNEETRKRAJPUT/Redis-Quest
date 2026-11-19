# F-22: a terminal that helps

Shared rules: `docs/specs/_wave2-common.md`. Read it first.

## Goal
The Redis terminal is where most levels are played. It should teach while you type and never lie: every hint
it shows comes from the running Redis's own command documentation, never from a hand-written table.

## Build
1. **Command knowledge from the server.** Load the command names once per session and each command's
   documentation on demand, by asking the running Redis itself (`COMMAND LIST`, `COMMAND DOCS <name>`: summary,
   arguments, group, complexity, since). First find out how `POST /api/cli` treats a command (read
   `engine/src/server.ts` around the cli route and whatever records terminal history or raises events): if a
   command sent there is recorded where a level's verifier or the learner's history can see it, do **not** send
   helper commands through it. In that case say so in the handoff, ship everything below that does not need
   the docs, and describe the small engine endpoint that would be needed. Never invent command facts.
2. **Completion.** While typing the first word: a popup above the prompt with matching commands (name, one-line
   summary, group), arrow keys and Tab to accept, Escape to close. After the command name: a one-line syntax
   hint with the argument at the cursor highlighted, built from the documented arguments. Subcommands
   (`CLIENT LIST`, `XINFO STREAM`) complete too. It must feel instant and must never block typing or change
   what Enter sends.
3. **History.** Up and Down walk the session's commands (keep whatever exists today), persisted for the
   browser session.
4. **Dangerous commands.** The existing warning stays (same trigger), restyled as a clear warning card.
5. **Chrome.** A proper terminal frame on the design system: title with the current target, a status light,
   the mono font, a visible focus state. Keep `data-testid="terminal"` and the focus fix from F-06 (clicking
   away must not make the page jump).
6. **Clickable commands in lessons.** In rendered lesson markdown (`src/markdown.tsx`), an inline code span
   or a line of a fenced block whose first word is a known Redis command gets a small "send to terminal"
   action that puts the text into the terminal's input line without running it (a tiny event bus in
   `src/terminal/bus.ts`; when no terminal is mounted the action copies to the clipboard instead). Markdown
   tests must still pass.

## Files you own
`ui/src/panels/TerminalPanel.tsx`, `ui/src/panels/terminalText.ts`, `ui/src/terminal/**`,
`ui/src/markdown.tsx`, `ui/src/redisReply.ts`, the existing tests `ui/test/{markdown,redisReply,panels}.test.*`,
new `ui/test/terminal*.test.ts(x)`, `ui/src/app/terminal/**`, `scripts/check/F-22.sh`, `docs/handoffs/F-22.md`.

## Keep working
`terminal`, `tab-terminal` behaviour inside the level workbench, the reply colouring, the target line, HELP.
Pure logic (matching, argument-position maths, history) lives in plain functions with unit tests.
