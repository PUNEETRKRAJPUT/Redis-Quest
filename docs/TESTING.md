# Playing Redis Quest as a tester (release candidate `v1.0.0-rc2`)

Thank you for being one of the first five. The whole game is now playable: eight chapters and 96 levels.
Test the tag `v1.0.0-rc2`, not `main` and not an older tag.

The point of this round is simple: **can a backend engineer who has never used Redis get through the
levels without asking anyone for help?** Start at Chapter 0 and keep going as far as you like. If you get
stuck, that is a finding, not a failure. Write down where, and keep going if you can.

**How long a chapter takes is not known yet.** Please note the time you start and stop each chapter, even
roughly. That is one of the things this round is for.

## What you need

- A Mac with Apple Silicon (M1 or newer) and at least 16 GB of RAM.
- **Docker Desktop for Mac** (Apple Silicon build) from docker.com. After installing, open it once, then
  go to **Settings → Resources** and set **Memory** to at least **8 GB**. Apply and restart Docker.
- Git. If `git --version` in Terminal offers to install the Command Line Tools, accept.
- About 6 GB of free disk for images and data.

Nothing else. No Node, no Homebrew, no Redis install.

## Start

```bash
git clone --branch v1.0.0-rc2 https://github.com/PUNEETRKRAJPUT/Redis-Quest.git
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

Two things you will meet later. In the terminal header there is a **target switcher** that points the game
at a different Redis (a replica, Sentinel, a cluster); you will be told when to use it. And **Chapter 5
needs extra containers** (a no-persistence node, a replica, Sentinel, a cluster): each level that needs
them says which `docker compose --profile ... up -d` command to run. If one of those levels does not say
enough to get you going, that is a finding.

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
anything yourself first; the raw experience is the data. If you are watching someone else play, do not
help them: write down where they stopped instead.

## Verified

The start flow (fresh clone, `.env` with only the Redis port changed, `./scripts/start`) was run on an
M-series Mac on 2026-11-01: preflight passed, the game answered on 3000, Redis Insight on 5540 already
showed the `Redis Quest` database, and the stats route served from Postgres. That run was on an earlier
tag; the tag you are testing is `v1.0.0-rc2`.

## Known limits in this round

- Only macOS on Apple Silicon is supported. Intel Macs, Windows and Linux are not, yet.
- The Chapter 5 levels that need the extra containers are the ones most likely to be slow or to hit a
  port that is already in use (6380, 26379 to 26381, 7100 to 7105); `./scripts/preflight.sh` lists them.
- The four Chapter 5 levels that need a profile (the crash node, the replica, Sentinel and the cluster)
  were played by hand by the author, not by the automatic grader; they are the ones to watch.
