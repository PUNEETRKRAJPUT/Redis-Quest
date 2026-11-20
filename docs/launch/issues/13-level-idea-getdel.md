---
title: "Level idea: a one-time code with GETDEL"
labels: levels, help wanted
---

**What.** Chapter 1 level 1 stores an OTP with `SET otp:<id> 483921 EX 120` and reads it with `GET` (`levels/ch1-keyspace/solutions/01-reference.redis`). A code that can be read twice can be used twice. `GETDEL` returns the value and deletes the key in one step. No level file uses it (`grep -rli getdel levels` is empty).

**Where to look.**
- `docs/redis-docs-digest.md` line 66 lists `GETSET/GETDEL/GETEX (6.2.0)` but says nothing more. Read the official `GETDEL` page and add what you rely on to the digest first: the game states no Redis fact that is not in the digest or the official docs.
- `levels/README.md`: "A complete level, annotated", and `levels/_examples/example-cli/` to copy from.

**Done when** there is a draft level (YAML, a reference solution, at least one wrong one such as GET followed by DEL, and a verifier that tells them apart) that `pnpm --filter @quest/shared levels:validate` accepts. Keep it in a scratch directory outside `levels/` at first. Adding a level to a chapter changes the count of 96 that `scripts/check/C-POL.sh` and the README assert, so the maintainer will decide where it lands.

**Notes.** Tone rules are in `docs/fiction.md`: no money framing, fictional names only.
