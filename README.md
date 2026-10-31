# Redis Quest

A story-driven game that takes a backend engineer with basic JavaScript from "never seen Redis" to
"can design, build, operate and defend a Redis system in an interview". Everything runs on your own
machine. Every level makes you do something real against a real Redis, a real Postgres and real
traffic, and shows you what broke and what you fixed.

**Status: under construction.** Nothing is playable yet. The design is in [docs/PLAN.md](docs/PLAN.md)
and the build board is in [docs/BUILD.md](docs/BUILD.md).

## What you will need (when it is ready)

- A Mac with Apple Silicon and at least 16 GB of RAM (v1 supports nothing else)
- Docker Desktop for Mac, with 8 GB of memory assigned to it
- Git (the Xcode Command Line Tools provide it)

Then:

```bash
git clone https://github.com/PUNEETRKRAJPUT/Redis-Quest.git
cd Redis-Quest
./scripts/start
```

and open http://localhost:3000.

## Licence

MIT for the game. Redis 8 is tri-licensed RSALv2 / SSPLv1 / AGPLv3 and Redis Insight is SSPL; both are
pulled as Docker images and run only on your machine.
