# postgres: the legacy database

Real, seeded, deliberately slow Postgres 16 behind the Nukkad Cricket League fantasy app. Database `quest`,
user `quest`, password `quest` (local only). Everything under `init/` runs once on first start of an empty
data volume; `docker compose down -v` then `up` re-seeds it.

| file | what |
|---|---|
| `init/001-schema.sql` | tables, with a comment on each |
| `init/002-seed.sql.gz` | GENERATED, committed gzipped (about 11 MB, 62 MB raw), `COPY ... FROM STDIN` blocks, ends with `VACUUM ANALYZE`; the Postgres image loads `*.sql.gz` from its init directory natively |
| `init/003-outbox.sql` | `outbox` table and `AFTER INSERT OR UPDATE OR DELETE` triggers on players, teams, matches, contests |
| `init/004-slow-by-design.sql` | the missing indexes (on purpose) and `player_stats(p_id text)` |
| `seed/generate.mjs` | the generator: plain Node ESM, no dependencies, reads `fiction/*.json` |

## Regenerate the seed
```
node postgres/seed/generate.mjs            # rewrites postgres/init/002-seed.sql.gz (about 5 s)
node postgres/seed/generate.mjs --out X    # write elsewhere
```
Fixed seed `quest-2026`, independent PRNG stream per section; two runs are byte-identical (the check diffs them).
If you change the generator, regenerate and commit the new `002-seed.sql.gz` with it. Never commit the raw `.sql`.

## Sizes (seed `quest-2026`)
20,000 users, 8 teams, 200 players, 12 colleges, 48 hostels, 60 matches (40 completed, 2 live, 18 scheduled),
9,741 balls, 200,135 fantasy teams, 2,201,485 fantasy_team_players, 3,660 contests, 200,135 contest entries,
100,078 wallet transactions, 20,000 wallets. Measured load on an M-series Mac: about 20 to 30 s from container start
to ready (limit 60 s).

## Slow by design
No index on `fantasy_team_players.player_id`, `contest_entries.user_id` or `balls.batter_id`/`bowler_id`.
`SELECT * FROM player_stats('p-028')` is the exact query behind `GET /app/players/:id/stats`. Measured
single-threaded p50 for hot player p-028 (five runs, M-series Mac, throwaway container): about 240 ms in the last
check run (earlier variants of the same function: 175 to 290 ms; it varies with machine load). Target was over 150 ms.
Do not add indexes here; fix it in Redis.

## Outbox
Triggers write one row per change (`op` insert|update|delete, `payload` = full new row, old row on delete). The
triggers are created after the seed loads, so a fresh database starts with an empty outbox. Drain rows where
`published_at IS NULL`; partial index `outbox_unpublished_idx`.

## Check
`scripts/check/P0-04.sh` (throwaway `postgres:16` container on a random port, never the compose stack).
