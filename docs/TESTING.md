# Playing Redis Quest as a tester (Milestone 1)

Thank you for being one of the first five. The point of this round is simple: **can a backend engineer
who has never used Redis get through Chapter 0 without asking anyone for help?** If you get stuck, that is
a finding, not a failure. Write down where, and keep going if you can.

## What you need

- A Mac with Apple Silicon (M1 or newer) and at least 16 GB of RAM.
- **Docker Desktop for Mac** (Apple Silicon build) from docker.com. After installing, open it once, then
  go to **Settings → Resources** and set **Memory** to at least **8 GB**. Apply and restart Docker.
- Git. If `git --version` in Terminal offers to install the Command Line Tools, accept.
- About 6 GB of free disk for images and data.

Nothing else. No Node, no Homebrew, no Redis install.

## Start

```bash
git clone https://github.com/PUNEETRKRAJPUT/Redis-Quest.git
cd Redis-Quest
./scripts/start
```

The first start downloads images and builds the game; expect a few minutes on a fast connection (with images already present it takes about twenty seconds). The script first runs a
preflight that tells you, in plain words, anything that is missing (Docker not running, too little
memory, a port already in use) and how to fix it. Read it. If it says a port is taken by `redis-server`
or `postgres`, you have a local Redis or Postgres running: either stop it (`brew services stop redis`)
or edit `.env` and change that port as the message suggests, then run `./scripts/start` again.

When it is up:

- the game: http://localhost:3000
- Redis Insight (the "see it" window): http://localhost:5540

Type a name, and play. Each level has seven stages; read them in order. The brainstorm asks for your
guess before it teaches you; guess honestly. The terminal inside the game talks to the Redis on your
machine.

## Stop, restart, reset

- Stop everything: `./scripts/stop`. Your progress is kept.
- Start again: `./scripts/start`.
- Wipe everything and start over (also wipes Redis and the database): `./scripts/reset`. Your progress
  file in `.progress/` survives on purpose; delete that folder too if you want a truly clean slate.

## What to write down (this is the whole point)

Keep a plain text note while you play, one line per item, with the level name:

1. Anywhere you stopped and did not know what to do next, even for thirty seconds.
2. Anything the game said that you did not understand.
3. Anything that looked broken, with what you clicked just before.
4. Anything that felt slow.
5. The one thing you would change first.

Then run this and attach the output and your note:

```bash
./scripts/preflight.sh
docker compose ps
tail -50 logs/engine/engine.log
```

Send it all to Puneet, or open an issue with the "Playtest finding" template on GitHub. Do not fix
anything yourself first; the raw experience is the data.

## Verified

This exact flow (fresh clone, `.env` with only the Redis port changed, `./scripts/start`) was run on an
M-series Mac on 2026-11-01: preflight passed, the game answered on 3000, Redis Insight on 5540 already
showed the `Redis Quest` database, and the stats route served from Postgres.

## Known limits in this round

- Chapters 0, 1 and the first four levels of Chapter 2 exist. The map ends there.
- The "ideal way" panel may be empty on some levels.
- Only macOS on Apple Silicon is supported. Intel Macs, Windows and Linux are not, yet.
