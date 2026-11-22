# The Economy League

Code golf for Redis, played by pull request. A **hole** is a small task. An **entry** is a list of Redis commands that
does the task. The score is **how many commands** the entry takes, and the lowest score wins, like a bowler's economy
rate. Nothing about speed is ever ranked: the same entry gets the same score on every machine.

Every hole has a **par**, the command count of the plain way to do it (the `par-house` entry). Every hole can be done
in fewer commands than par by someone who knows the right command. Finding it is the game.

## Your first entry in five minutes

1. Pick a hole in `golf/holes/` and read its `hole.yaml` (the `task` says what must be true afterwards; `setup` is
   what is already in the database; `checks` are the exact tests).
2. Create one file: `golf/holes/<hole>/entries/<your-github-handle>.redis`. The file name is your GitHub handle, in
   the case you use it. One person, one entry per hole.
3. Write one Redis command per line. Lines that start with `#` are comments and cost nothing. Quote an argument
   with spaces the way `redis-cli` does: `HSET player:7 name "Meera Rao"`.

   ```
   # golf/holes/<hole>/entries/octocat.redis
   # a comment costs nothing
   SET some:key "a value with spaces"
   ```
4. Open a pull request. Touch only your own entry file. A check called **league** runs your entry, writes the
   score tables to the job summary, and fails the pull request if your entry does not pass the hole's checks.
5. When the check is green, a maintainer merges. Your row is on the board.

You may improve your own entry later by editing the same file in a new pull request.

## What an entry may contain

- Plain Redis commands, one per line, split the way `redis-cli` splits them (quotes, `\n` and `\xHH` escapes).
- At most 100 commands and 16 KiB.
- **Not allowed** (the check names the line and the reason): `EVAL`, `EVALSHA`, `FCALL`, `FUNCTION`, `SCRIPT`, `DEBUG`,
  `FLUSHALL`, `CONFIG`, because a script or a configuration change makes a command count meaningless; and anything that
  could leave the scoring database or never return: `SELECT`, `MOVE`, `SWAPDB`, `FLUSHDB`, `COPY ... DB`, `MIGRATE`,
  `RESET`, `HELLO`, `AUTH`, `CLIENT`, transactions (`MULTI`, `EXEC`, `DISCARD`, `WATCH`, `UNWATCH`), blocking commands
  (`BLPOP` and the like), `SUBSCRIBE` and friends, `SHUTDOWN`, `SAVE`, `BGSAVE`, `REPLICAOF`, `ACL`, `CLUSTER`. The full
  list is `packages/shared/src/league/refuse.ts`.
- An entry that makes Redis answer with an error on any line gets no score.

## How an entry is scored

1. The scoring database is emptied. Scoring uses logical database 7 on whatever Redis it is given, never database 0.
2. The hole's `setup` commands run.
3. Your entry runs, line by line.
4. The hole's `checks` run. They have the same shape as the checks in a level file (`levels/README.md`): one command,
   one assertion. **If any check fails there is no score.**
5. Score, lowest wins, compared in this order:
   1. the number of commands in your entry;
   2. the bytes the checked keys use: `MEMORY USAGE` summed over every argument of every check that is a key;
   3. the length of your command lines in characters (trimmed, joined by one newline; comments and blank lines do not
      count).
   Entries that tie on all three share a rank.

## What the pull request check says

The job summary has one table per hole, best first:

```
## 01-kit-room: Stock the kit room (par 5)

| rank | handle    | commands | bytes | chars | vs par |
| ---- | --------- | -------- | ----- | ----- | ------ |
| 1    | octocat   | 1        | 480   | 70    | -4     |
| 2    | par-house | 5        | 480   | 78    | par    |
```

If something is wrong the job fails and prints a line you can follow, with the file, line and what to change:

```
golf/holes/01-kit-room/entries/octocat.redis:2:1 (root): EVAL is not allowed: scripts make the command count meaningless
FAIL 01-kit-room octocat: kit:bat must hold 12 (expected 12, got 21)
```

The numbers above are an illustration of the layout, not measured scores.

## Trying an entry before you push

- In the game: open **Economy League** on the map (`/league`), pick the hole, paste your commands, and press Score it.
  It scores against your own Redis in database 7 and tells you where your attempt would rank. Not available when the
  target is a cluster (a cluster has one database).
- On your own machine, against a **throwaway** Redis (scoring empties database 7 of whatever it connects to):

  ```
  pnpm install && pnpm --filter @quest/shared build
  REDIS_URL=redis://127.0.0.1:6379 node scripts/league/score.mjs
  ```

  `node scripts/league/score.mjs golf/holes/01-kit-room` scores one hole.

## Adding a hole

`golf/holes/<nn>-<slug>/hole.yaml`, plus an `entries/par-house.redis` that takes exactly `par` commands.

```yaml
title: Stock the kit room # at most 60 characters
task: | # plain words, markdown allowed: what must be true afterwards
  ...
par: 5 # the command count of the plain way
setup: # optional: commands run before the entry
  - cmd: [SADD, 'squad:bench', p1]
checks: # at least one; one assertion each; read-only commands only
  - cmd: [GET, 'kit:bat']
    equals: 12
    message: kit:bat must hold 12 # optional, shown when the check fails
```

A hole is only good if it can be beaten: before you open the pull request, find the shorter way yourself and say in
the pull request which command it uses. `levels/README.md` lists every assertion (`equals`, `between`, `exists`, ...).
Holes are checked for the same rules as entries: no refused commands in `setup`, no writes in `checks`.

## Redis facts this page relies on, and where they come from

- Commands are named in the holes, not explained here; the game states nothing about a command's behaviour that is
  not in `docs/redis-docs-digest.md`, in the running server's own `COMMAND DOCS`, or labelled as "not verified".
- Removing the last member of a set, list or sorted set deletes the key (digest, lists section, "auto create/delete
  rule", for all aggregate types except streams). Hole 04 depends on it for the set case.
- Not in the digest, so **not verified here**: that the scoring connection can use logical database 7; the exact
  `MEMORY USAGE`, `CLIENT INFO` and `FLUSHDB` behaviour the scorer uses. The league workflow runs all of them against
  a `redis:8` service on every pull request; that run is the evidence.
