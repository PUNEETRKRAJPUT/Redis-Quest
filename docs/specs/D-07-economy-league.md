# D-07: the Economy League

Rules for every day task: `docs/specs/_days-common.md`. Branch: `day-07-economy-league`.

## Goal
Code golf for Redis, played by pull request. A hole is a small task; an entry is a list of Redis commands; the
score is how few commands it takes, and the lowest score wins, like a bowler's economy rate. Scores are
deterministic: nothing about speed is ever ranked.

## Build
1. **Format** (`golf/README.md` explains it to a contributor): `golf/holes/<nn>-<slug>/hole.yaml` (title, the
   task in plain words, `setup` commands, `checks` in the same shape the level schema uses for Redis checks,
   and `par`), `golf/holes/<nn>-<slug>/entries/<github-handle>.redis` (one command per line, `#` comments).
   A schema and a loader in `packages/shared/src/league/` with positioned errors.
2. **The scorer** (pure, in `packages/shared/src/league/`, given a function that runs one command): flush the
   scratch database, run the setup, run the entry, run the checks. A failed check means no score. The score is
   the number of commands in the entry; ties break on the bytes the entry's keys use (`MEMORY USAGE`, summed
   over the keys the checks name), then on the entry's length in characters. Commands that would make it
   pointless (`EVAL`, `EVALSHA`, `FCALL`, `FUNCTION`, `SCRIPT`, `DEBUG`, `FLUSHALL`, `CONFIG`) are refused.
   State every Redis claim in the README with its source or as "measured on this stack".
3. **Six holes** across strings, hashes, sorted sets, sets, lists and expiry, each with a house entry at par.
   Each hole must be solvable in fewer commands than par by someone who knows a multi-key or variadic command.
4. **`scripts/league/score.mjs`**: scores every entry against a Redis given by `REDIS_URL` using a logical
   database of its own (never database 0), prints a table per hole, exits 1 on an entry that fails its checks.
5. **`.github/workflows/league.yml`**: on pull requests that touch `golf/**`, with a `redis:8` service: build
   the shared package, run the script, write the tables to the job summary.
6. **In the game** (`/league`): the holes, an editor for an attempt, "Score it" through
   `POST /api/league/score` in `engine/src/features/league.ts` (the same scorer, on a logical database of its
   own on the current target; refuse politely when the target is a cluster, which has one database), the
   scorecard, where the attempt would rank among the committed entries (`GET /api/league`), and how to submit
   it as a pull request.
7. Turn the feature on in `ui/src/features/league/entry.ts`.

## Files you own
`golf/**`, `packages/shared/src/league/**` (and its export from the shared index), `scripts/league/**`,
`.github/workflows/league.yml`, `engine/src/features/league.ts`, `ui/src/features/league/**`,
`ui/src/app/league/**`, tests, `scripts/check/D-07.sh`, `docs/handoffs/D-07.md`.

## How it will be verified later
`scripts/league/score.mjs` against a throwaway Redis: every house entry scores exactly par.
