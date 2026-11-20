---
title: "Share the .env PROXY_PORT lookup between hit.sh and ticker-drill.sh"
labels: good first issue, scripts
---

**What.** `scripts/hit.sh` and `scripts/ticker-drill.sh` contain the same five lines: take `PROXY_PORT` from the environment, else from `.env`, else 3000. A third copy of the idea (`envval`) lives in `scripts/start`. A fix to one will not reach the others.

**Where to look.**
- `scripts/hit.sh` lines 14 to 18 and `scripts/ticker-drill.sh` lines 13 to 17: the identical block.
- `scripts/start`: `envval`, which also handles the other ports.
- The rules for scripts are in `CLAUDE.md`: `#!/usr/bin/env bash`, compatible with bash 3.2, BSD tools, no GNU-only flags.

**Done when** the two drill scripts get the port from one small sourced file (for example `scripts/lib/env.sh` with a function `quest_env PROXY_PORT 3000`) and behave exactly as before: environment first, then `.env`, then the default. `bash -n` passes on all three files. Do not run `scripts/start`; a bare `docker compose` here acts on the player's own game.
