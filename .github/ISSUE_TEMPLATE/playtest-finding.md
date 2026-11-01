---
name: Playtest finding
about: Something you hit while playing (stuck, confused, broken, slow)
title: "[playtest] <level or screen>: <one line>"
labels: playtest
---

**Where** (chapter and level, or screen):

**What happened** (what you did, what you saw, what you expected):

**How long you were stuck before writing this** (even 30 seconds counts):

**Your Mac** (model, macOS version, Docker Desktop memory setting):

**Attach** the output of these, run inside the repo:

```bash
./scripts/preflight.sh
docker compose ps
tail -50 logs/engine/engine.log
```
