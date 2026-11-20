---
title: "Test that setup refuses FLUSHALL, FLUSHDB, SHUTDOWN and game:* keys"
labels: good first issue, tests, engine
---

**What.** `assertSetupCommandAllowed` in `engine/src/setup.ts` is described as "defence in depth": the level schema already refuses these, and the engine refuses them again when a level's `setup` runs. Nothing in `engine/test` imports `engine/src/setup.ts` (`grep -rn "src/setup" engine/test` is empty), so the second line of defence is untested.

**Where to look.**
- `engine/src/setup.ts`: `assertSetupCommandAllowed`, `runSetup`, `SetupRefusedError`.
- `packages/shared/src/levels/commands.ts`: `SETUP_FORBIDDEN_COMMANDS` (`FLUSHALL`, `FLUSHDB`, `SHUTDOWN`).
- `levels/README.md`, "Rules that cut across fields": the same rule from the level author's side.

**Done when** `engine/test/setup.test.ts` covers: each forbidden command throws `SetupRefusedError` in any letter case; an argument that starts with `game:` throws; an ordinary `SET` passes; `runSetup` with a list that has a forbidden command in the second step runs **none** of the steps (the code refuses the whole list first), checked with a fake `RedisManager` that records calls; `sql` and `script` steps are reported in `skipped`, not run.
