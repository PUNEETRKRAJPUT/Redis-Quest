# Redis Quest

Redis Quest is a story-driven game that takes a backend engineer with basic JavaScript from "never seen
Redis" to "can design, build, operate and defend a Redis system in an interview". You play the backend
engineer of a fantasy cricket app that a hostel roommate and you built in a weekend, and the app goes very
wrong in the best way, one chapter at a time. Everything runs on your own Mac: every level makes you do
something real against a real Redis, a real Postgres and real traffic, and tells you honestly what broke and
what you fixed.

## Who it is for

A backend developer (or a student about to become one) who writes JavaScript, has heard of Redis and has
never run it under load. You do not need to know any Redis. If you can read an HTTP route and a SQL query,
you can play. The game is in English with a little Hinglish, and the story is set in an Indian college fest.

Windows and Intel Macs are not supported in this version. Linux is not supported either.

## What you need

- A Mac with Apple Silicon (M1 or newer) and at least 16 GB of RAM
- Docker Desktop for Mac (the Apple Silicon build), with 8 GB of memory assigned to it
  (Settings, Resources, Memory)
- Git (the Xcode Command Line Tools provide it)
- About 10 GB of free disk space; the preflight checks for it, and the images take about 2 GB

No Node, no Homebrew, no Redis install.

## Start

```bash
git clone https://github.com/PUNEETRKRAJPUT/Redis-Quest.git
cd Redis-Quest
./scripts/start
```

Then open http://localhost:3000. The first start downloads images and builds the game, so give it a few
minutes. `scripts/start` runs `scripts/preflight.sh` first and tells you in plain words what is missing.
Redis Insight (the window where you can see your keys) is at http://localhost:5540.

## The eight chapters

There are 96 levels. Each chapter opens with a chat thread that is the incident.

| Chapter | Title                  | Levels | What you build                                                                                                                                                         |
| ------- | ---------------------- | ------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0       | Boot                   | 5      | Bring the stack up, find your own save file in Redis, survive the roommate who ran `docker compose down`                                                               |
| 1       | The keyspace           | 16     | Profiles, wallet points, team picks, favourite players, a first scoreboard, a login streak, a visitor count, a stadium map; then your first code, registering a user   |
| 2       | Everyone showed up     | 13     | A cache for the player stats page, fixtures kept fresh from the legacy database, OTP login sessions; then three timed interviews                                       |
| 3       | Compete and talk       | 15     | A rate limiter that works across app copies, live leaderboards, a wallet that cannot go negative, the live ticker; then three timed interviews                         |
| 4       | Work in the background | 19     | A ball-by-ball stream with workers that recover, a job queue, a lock for the last contest slot, username and contest lookups, an ops wall; then three timed interviews |
| 4b      | On call                | 7      | Diagnose first, fix second: six planted faults and an on-call checklist                                                                                                |
| 5       | Survive and scale      | 14     | Persistence that fits, a replica, automatic failover, a cluster, locking the door, a production checklist                                                              |
| Finale  | The architect          | 7      | Three mock interviews drawn for you, a decision gauntlet, a code review, and your story                                                                                |

The level counts above are the number of level files in each chapter's directory under `levels/`.
Chapter 5 uses extra containers (a no-persistence node, a replica, Sentinel, a cluster). The levels tell
you which `docker compose --profile ... up -d` command to run and when; nothing extra starts by default.

## How a level works

Every level has the same seven stages, and you only touch the Redis part.

1. **Scenario**: the chat thread, what just happened and who is shouting.
2. **What already exists**: what is built and running, so you do not rebuild it.
3. **Brainstorm**: before any teaching, you pick an approach and write one line. Nothing is graded; the point
   is to commit to a guess. The game shows it back to you after.
4. **Teach**: the concept, the commands and a link to the official docs.
5. **Build**: run commands in the terminal, fill in one file, run a command on your Mac, or make a decision.
   Hints open one at a time.
6. **Verify**: the game checks your work and gives one of three verdicts:
   - **Right**: it works, and the "show me" panel shows it running on your own keys.
   - **Works, but wrong**: it passes today, and the game shows you how it fails under load.
   - **Wrong**: a check failed, and the message says which one and the most likely cause.
7. **The ideal way**: the reference answer, side by side with yours. It opens after you pass, after three
   failed attempts, or when you ask for it.

Levels give XP and some give badges. **Interview levels** are different: a countdown clock, no teaching
page, a blank file, and a hint costs XP (the screen tells you the price before you spend it). The chapter
interviews (the last three levels of Chapters 2, 3 and 4) do not move your earlier file, so copy it to a safe
name first if you want to keep it. In the Finale the game draws the use case for you, moves your earlier file
aside as `<file>.before-<level>` (next to it) and gives you an empty one. After your code passes, the interviewer asks
follow-up questions.

## The tools

- **Terminal**: in the page, talks to the Redis on your machine.
- **Editor**: for the levels where you write code; you can also use your own editor on the same files.
- **Run my code in the app**: a switch in the Build stage of code levels. Off, the app runs its own slow
  baseline; on, the app runs your file.
- **Run traffic**: a button on levels that have a load scenario; it sends real traffic at the app for a few
  seconds so you can watch what your change does.
- **Target switcher**: in the terminal header. It points the game at the single node, the no-persistence node,
  the replica, Sentinel or the cluster, or at a Redis URL of your own. The app and the runner follow within
  about two seconds. Chapter 5 uses it.
- **Redis Insight**: http://localhost:5540, already connected to the game's Redis.
- **Logs and Metrics**: two pages in the sidebar. Logs shows what your code and the services print; Metrics
  shows latency and request numbers from the app.
- **What you built**: a page with every level you passed, each with its show-me running on your keys.
- **Write my story**: a button on that page that writes `workspace/PORTFOLIO.md`, a one-page account of what
  you built, with numbers the game measured.

## Where your work lives

- `workspace/`: your code, one JavaScript file per level at `workspace/<chapter>/<file>.js`. See
  [workspace/README.md](workspace/README.md) for the three rules. The scripts never touch it.
- `.progress/progress.json`: your save file (name, brainstorm lines, attempts, XP, verdicts). The game also
  mirrors it into Redis under `game:*`.
- `<file>.before-<level>` next to the original in `workspace/`: the backups the Finale's mock interviews make
  of your earlier files.
- `workspace/PORTFOLIO.md`: your story, once you write it.
- `logs/`: what the services wrote.

## Stop, reset and start over

- `scripts/stop`: stops everything. Your Redis and Postgres data, your progress and your files are kept.
- `scripts/start`: starts it again.
- `scripts/reset`: asks first, then deletes the Redis, Postgres and Redis Insight data volumes. It keeps
  `.progress/` and `workspace/`.
- For a truly clean slate, run `scripts/reset` and then delete the `.progress/` folder. Your code in
  `workspace/` stays; empty a file to start its level blank.

## Troubleshooting

Run `scripts/preflight.sh` first. It checks the CPU, macOS 14 or newer, Docker, memory, disk, Git and every
port below, and says how to fix what it finds.

| Port                | What uses it        | If something else holds it                                |
| ------------------- | ------------------- | --------------------------------------------------------- |
| 3000                | the game            | set `PROXY_PORT` in `.env`                                |
| 5540                | Redis Insight       | set `INSIGHT_PORT` in `.env`                              |
| 6379                | Redis               | `brew services stop redis`, or set `REDIS_PORT` in `.env` |
| 5432                | Postgres            | stop your local Postgres, or set `PG_PORT` in `.env`      |
| 6380                | Chapter 5 replica   | stop what holds it; this port is fixed                    |
| 26379, 26380, 26381 | Chapter 5 Sentinels | stop what holds them; fixed                               |
| 7100 to 7105        | Chapter 5 cluster   | stop what holds them; fixed                               |

Every port is bound to 127.0.0.1, so nothing is reachable from your network.

- **A port is in use**: copy `.env.example` to `.env`, change the number, run `scripts/start` again.
- **Docker memory**: Docker Desktop, Settings, Resources, Memory: 8 GB, then Apply and restart. The
  preflight fails below 6 GB.
- **Disk under 10 GB**: empty the Trash; `docker system prune -a` removes unused images.
- **The first start loads a 60 MB seed into Postgres**: give it a minute before you open the game.
- **Docker is not running**: `open -a Docker`, wait until the whale stops animating, then try again.

## Contributing and how it was built

The game was built in small tasks, each with a written spec, one acceptance check in `scripts/check/` and a
handoff note, then committed by one orchestrating session. The task board is [docs/BUILD.md](docs/BUILD.md),
the full design is [docs/PLAN.md](docs/PLAN.md), the story's names and tone are in
[docs/fiction.md](docs/fiction.md), and how levels are graded is in [docs/grading.md](docs/grading.md). To add
or change a level, read [levels/README.md](levels/README.md) and keep `pnpm --filter @quest/shared
levels:validate levels` clean. If you are a playtester, start with [docs/TESTING.md](docs/TESTING.md).

## Licence

MIT for the game. Redis 8 is tri-licensed RSALv2 / SSPLv1 / AGPLv3 and Redis Insight is SSPL; both are
pulled as Docker images and run only on your machine. Starting the stack accepts Redis Insight's terms
on your behalf so you never see a first-run dialog; analytics and notifications are left off.
