# E-06: the engine serves Redis's own command docs to the terminal

## Goal
The terminal's completion and syntax hints (F-22) are built and waiting for one thing: a read-only way to get the
running Redis's command names and documentation without sending helper commands through `POST /api/cli`
(that route raises level events and shows up in the commandstats the lessons read; the evidence is in
`docs/handoffs/F-22.md`, section "Safety finding"). The engine takes one snapshot from Redis and serves it.

## Contract (the UI is already written against it: read `ui/src/terminal/docs.ts`, `ui/test/terminal.fixtures.ts`
## and the endpoint section of `docs/handoffs/F-22.md`, and match them exactly)
```
GET /health                       adds  commandDocs: true
GET /api/command-docs/names       -> { names: string[] }    the server's COMMAND LIST, verbatim
GET /api/command-docs?names=a,b   -> { reply: [...] }       the server's COMMAND DOCS reply for those names, in the
                                                            shape engine/src/verify/reply.ts normalizeReply produces;
                                                            at most 20 names; unknown names are simply absent
both, when no snapshot exists     -> HTTP 200 { available: false }
```
- **One snapshot, never per request.** When Redis is first reachable the engine runs `COMMAND LIST` and one
  `COMMAND DOCS` and keeps the result in memory. Requests are answered from memory: serving help sends zero
  commands to Redis. If the snapshot cannot be taken (Redis down, or busy with a script), the endpoints answer
  `{ available: false }` and the engine tries again the next time Redis comes up; it never retries on a timer
  tighter than the engine's existing reconnect handling and never from inside a request.
- **Refresh only when the target changes to a different server** (`PUT /api/target`), using the same rule.
- The snapshot must not raise any level event, must not go through the cli route's code path, and must not
  write a key.
- Bad input (`names` missing, empty, more than 20, or not plain command names) is a 400 with the engine's usual
  error shape.

## Read first
`CLAUDE.md`, `docs/handoffs/F-22.md`, `engine/src/server.ts` (the cli route, the health route, how the engine
tracks Redis up and down and target switches), `engine/src/cli.ts`, `engine/src/verify/reply.ts`,
`docs/redis-docs-digest.md` for anything you state about Redis. Never invent a Redis fact: what you say about
`COMMAND LIST` and `COMMAND DOCS` must be in the digest, in the official docs, or measured by you on Redis 8 and
labelled "measured on this stack".

## Files you own
`engine/src/command-docs.ts` (new) and the smallest possible edits in `engine/src/server.ts` (and wherever the
engine learns that Redis came up or the target changed), `engine/test/command-docs.test.ts` (new),
`scripts/check/E-06.sh`, `docs/handoffs/E-06.md`. Do not touch `ui/**`, level files, Docker or compose files.

## Verify (no image build, no compose project)
- `pnpm --filter @quest/engine build`, `lint`, and the engine's tests (see how the other engine tests get their
  Redis; run only what you can run without a compose stack, and say what you ran).
- `scripts/check/E-06.sh` (bash 3.2, exit 0, prints what it verified, cleans up after itself): starts one
  throwaway `redis:8` container of its own (name `quest-e06-redis`, `--platform linux/arm64`, host port
  127.0.0.1:6396, removed at the end), runs the built engine as a plain Node process on a free port with scratch
  directories for progress, workspace and logs, and proves through HTTP:
  1. `/health` reports `commandDocs: true`;
  2. names returns several hundred names including `get`, `zadd` and a subcommand such as `client|list`;
  3. docs for `get,zadd,xadd,nosuchcommand` returns the three and omits the unknown one, and the summaries equal
     what `COMMAND DOCS` itself returns on that Redis (ask Redis directly with `redis-cli` inside the container);
  4. after fifty names and docs requests, `INFO commandstats` shows the `command|docs` and `command|list` call
     counts unchanged from before the fifty requests;
  5. with the Redis container stopped before the engine starts, both endpoints answer 200 `{ available: false }`,
     and after Redis starts they recover without restarting the engine;
  6. the response for docs matches the fixture shape the UI tests use (compare one command against
     `ui/test/terminal.fixtures.ts`).
- Never touch the compose projects `redis-quest` or `quest-dev`, never bind ports 3000, 3100, 3400, 6394 or 5436,
  never run `scripts/start|stop|reset`.

## Handoff
`docs/handoffs/E-06.md`: what you did, commands and results, snapshot size in memory (measured), what you did not
do, surprises. Do not edit `docs/BUILD.md`.
