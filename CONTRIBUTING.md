# Contributing to Redis Quest

Thanks for wanting to help. Redis Quest is a local game that teaches Redis to backend engineers, and it is
small enough that one careful change can matter. This page tells you what to expect and how to make a pull
request that gets a quick answer.

## Before you start

- **The game runs on Apple Silicon Macs only** (M1 or newer, macOS, Docker Desktop for Mac). Every container
  image is pinned to `linux/arm64`, and the scripts assume macOS and bash 3.2. Linux, Windows and Intel Macs
  are not supported, and a pull request that adds support for them will be declined for now.
- **Running the whole game, or the full set of checks, needs Docker and about 16 GB of RAM.** If your Mac is
  smaller, you can still write levels, docs and TypeScript: the machine verdict on your pull request (below)
  runs on GitHub, not on your laptop.
- **Never run a check, or anything else that calls `docker compose`, against the default compose project.**
  The file `docker-compose.yml` names its project `redis-quest`, so a bare `docker compose` call acts on the
  stack you play on: it stops your Redis and Postgres and can write into your save. A check script must either
  call `quest_isolate` from `scripts/check/lib/isolate.sh` first (it gives the check its own project name,
  ports, image tag and scratch folders, and refuses to continue if Compose would still pick the default) or
  scope every call with `-p <its own project>`. `scripts/check/G-03.sh` reads every script in `scripts/check/`
  and fails when it finds a bare call. The story behind the rule is in
  [docs/handoffs/G-03.md](docs/handoffs/G-03.md).

## Ways in, by size

1. **A typo, a clearer sentence, a broken link.** Open a pull request directly. No issue needed.
2. **A level that confuses you or is wrong.** Open an issue with the "Playtest finding" or "Bug" template.
   If you can fix it, say so in the issue and send the fix.
3. **A new level or a new chapter idea.** Open an issue with the "Level idea" template first. A level has to
   be gradable by the harness, so the idea is checked against that before anyone writes YAML. The format is
   in [levels/README.md](levels/README.md).
4. **A change to the engine, the app, the runner or the UI.** Open an issue first and describe the problem you
   want to solve. These packages have rules that are easy to break from outside (the key prefix `game:*`
   belongs to the engine, the UI has a design system, nothing may leave the origin). Wait for a reply before
   you spend a weekend on it.
5. **Anything that adds a dependency, a hosted service, or content about AI, vectors or LLMs.** These are out
   of scope. The game is fully local and teaches Redis itself.

## How the repository works

Work here is done in small tasks. Each one has:

- a **spec** in `docs/specs/` that says what to build and which files the task owns;
- a **check** in `scripts/check/` that proves it (exit code 0 on success, prints what it verified);
- a **handoff note** in `docs/handoffs/` that says what was done, what was verified, what was not, and what
  surprised the author;
- **one commit** on `main`, with a message that starts with the task id.

You do not have to write a spec for a small fix. For anything bigger, a short description in the issue is
enough, and the maintainer will turn it into a spec with you. The task board is [docs/BUILD.md](docs/BUILD.md)
and the full design is [docs/PLAN.md](docs/PLAN.md); read the part your change touches, not all of it.

Two rules from the project's own conventions apply to every change:

- **Never state a Redis fact you did not check.** Anything a level says about Redis must trace to
  [docs/redis-docs-digest.md](docs/redis-docs-digest.md) or the official documentation, or be labelled as a
  simulation or as "measured on this stack".
- **The campaign does not change by accident.** Eight chapters, 96 levels, their XP and badges. A change that
  moves any of those needs an issue first.

## How levels are graded (and why it matters for your pull request)

Nothing a learner writes is graded by reading it. Each level declares checks, and the engine runs them against
a real Redis, a real Postgres and the real app. Every level also ships a reference solution and at least one
wrong one, each declaring the verdict it must get. The grading harness (`scripts/grade/`) plays all of them
through the engine and prints a table. A `MISMATCH` row means the level does not behave as it declares; a level
with a mismatch is not finished. See [docs/grading.md](docs/grading.md).

Some levels cannot be graded by a machine that is not an Apple Silicon Mac with the full stack: levels that
need a Compose profile (replica, Sentinel, cluster), a real Redis outage, or traffic judged on latency or on a
baseline measured on the same machine. Those are marked `SKIPPED` in the machine verdict, with the reason, and
the maintainer grades them by hand before merging. A skip is not a failure.

## What happens when you open a pull request

A GitHub Actions workflow named `pr-verdict` builds the repository, starts the engine, the app and the runner
against a Redis and a Postgres on a GitHub runner, and grades every level that does not depend on the speed of
the machine. It writes the table into the job summary on the pull request. Your pull request also goes through
the `ci` workflow: build, lint, unit tests, format check and level validation.

A green verdict is necessary, not sufficient. The maintainer reads the diff, and for anything that touches
levels, scripts or workflows also runs the full checks on a Mac.

## Running things yourself

You need a Mac that meets the limits above, Node 22 (the version in `.node-version`) and pnpm (the version in
`package.json`, through `corepack enable`).

```bash
pnpm install --frozen-lockfile
pnpm --filter @quest/shared build               # other packages import its built output
pnpm --filter @quest/shared levels:validate levels
pnpm format:check                                # prettier; `pnpm format` fixes it
scripts/dev/check.sh <package>                   # type-check and lint one package
```

To play the game itself, follow the README. To run a check that drives Docker, read the check first and
confirm it isolates itself (`grep -n quest_isolate scripts/check/<id>.sh`). If you are not sure, do not run it.
Checks that start the stack take minutes and a lot of memory.

If you changed a level, run the grading harness on it against a stack that is not your own save: a scratch
progress directory, as [docs/grading.md](docs/grading.md) describes. The harness unlocks levels and completes
them, so pointing it at the game you play on will change your save.

## Your pull request

- Keep it to one thing. Say what problem it solves and how you know it works (the command you ran and what it
  printed).
- Say what you did not check. "I could not run the Sentinel levels" is a useful sentence.
- Do not change `pnpm-lock.yaml`, a `package.json`, `docker-compose.yml` or anything under `.github/` unless
  the issue you opened said you would. Those files run on other people's machines and on GitHub.
- Format with prettier before you push.
- Be patient. This is a one-person project and a reply can take a few days.

By contributing you agree that your work is released under the [MIT licence](LICENSE) that covers the game.

## Conduct and security

Everyone who takes part follows the [code of conduct](CODE_OF_CONDUCT.md). To report a security problem, read
[SECURITY.md](SECURITY.md) first.
