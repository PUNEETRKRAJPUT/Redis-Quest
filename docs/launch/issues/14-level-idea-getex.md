---
title: "Level idea: sliding expiry on a string with GETEX"
labels: levels, help wanted
---

**What.** The session level reads a session and then refreshes its expiry in a separate `MULTI` (`get` in `levels/ch2-everyone-showed-up/solutions/08-reference.js`: `HGETALL`, then `HSET last_seen_at` and `EXPIRE` together). For a value kept as a plain string, `GETEX key EX seconds` reads and refreshes in one command. No level uses it (`grep -rli getex levels` is empty).

**Where to look.**
- `levels/ch2-everyone-showed-up/08-otp-login-properly.yaml` and its solution file, to see what the existing level already teaches about sliding expiration.
- `docs/redis-docs-digest.md` line 66 (names `GETEX`, no detail): read the official page and extend the digest before writing a lesson.
- `levels/_examples/example-cli/` for a template.

**Done when** there is a draft `cli` level with a reference solution, a wrong one (for example `GET` then `EXPIRE` in two steps, which leaves a gap) and a verifier that fails the wrong one, accepted by `levels:validate`. Keep it outside `levels/` until the maintainer decides where it goes (the 96-level count is asserted in `scripts/check/C-POL.sh`).
