---
name: Bug
about: Something in the game, the scripts or the docs is broken or wrong
title: "[bug] <where>: <one line>"
labels: bug
---

**What is broken** (one or two sentences):

**Steps to reproduce** (what you ran or clicked, in order):

1.
2.
3.

**What you expected, and what happened instead** (paste the exact message if there is one):

**Where** (chapter and level id, or screen, script or file):

**Version** (the tag, or the commit from `git rev-parse --short HEAD`):

**Your Mac** (model, macOS version, Docker Desktop memory setting). Redis Quest supports Apple Silicon Macs only:

**Attach** the output of these, run inside the repo (they only read; they do not change your game):

```bash
./scripts/preflight.sh
docker compose ps
tail -50 logs/engine/engine.log
```

**Is it a security problem?** Do not post details here. Read SECURITY.md.
