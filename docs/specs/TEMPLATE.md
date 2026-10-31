# <id>: <title>

**Goal.** Two sentences.

**Depends on.** <task ids that must be done first, or "nothing">

**Files owned.** (the only paths this task may create or change)
- `path/`
- `path/file`

**Must not touch.** <paths other in-flight tasks own>

**Interfaces to honour.** <types, routes, env names, key prefixes, port numbers; link PLAN.md sections>

**Work.**
1. ...
2. ...

**Acceptance check.** `scripts/check/<id>.sh` must:
- ...
- exit 0 and print each thing it verified

**Handoff complete when.** check passes on an Apple Silicon Mac; `docs/handoffs/<id>.md` written with
command output; no files outside "Files owned" changed.

**Model.** sonnet | opus (and why, if opus)
