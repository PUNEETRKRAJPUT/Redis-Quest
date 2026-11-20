---
title: "Add a unit test for the engine log tailer (LogTail)"
labels: good first issue, tests, engine
---

**What.** `LogTail` in `engine/src/logtail.ts` polls `${logDir}/<service>/**` and streams new lines to the Logs page. Its `poll()` method carries the comment "Exposed for tests", but no test file imports it (`grep -rn LogTail engine/test` finds nothing).

**Where to look.**
- `engine/src/logtail.ts`: the ring of 500 lines per service, the 64 KB tail read at startup (`INITIAL_TAIL_BYTES`), `skipFirst` for a read that starts mid-line, the reset when a file shrinks, the depth limit (`MAX_DEPTH`).
- `engine/src/events.ts`: `EventBus.subscribe` and `emit`, to capture the `log.line` events.
- `engine/test/workspace.test.ts`: a test that builds a temporary directory with `mkdtemp`; copy that pattern.

**Done when** a new `engine/test/logtail.test.ts` covers at least: lines written after `start()` are emitted as `log.line`; lines that already existed seed the ring but are not emitted; a half-written last line is held back until its newline arrives; a file that is truncated is read again from the start.

**Notes.** Call `poll()` yourself instead of waiting for the timer. The tests are not run by the author's machine, so CI is the first run: please say in the pull request that you ran it.
