# P0-04: Postgres schema, deterministic seed, outbox triggers, the deliberately slow query

**Goal.** Give the fantasy-cricket app a real, seeded, deterministic Postgres that every learner gets
byte-for-byte identical, with one honestly slow hot query for Chapter 2 to rescue and an outbox table
for the prefetch-cache CDC worker.

**Depends on.** P0-03 (fiction JSON), Docker running (P0-02 is not required; the check uses a throwaway
`postgres:16` container).

**Files owned.**
- `postgres/README.md`, `postgres/init/001-schema.sql`, `postgres/init/002-seed.sql` (generated, committed),
  `postgres/init/003-outbox.sql`, `postgres/init/004-slow-by-design.sql`
- `postgres/seed/` (generator: `generate.mjs`, plain Node ESM, no dependencies, reads `fiction/*.json`)
- `scripts/check/P0-04.sh`

**Must not touch.** `fiction/` (read only), `docker-compose.yml`, `packages/`, `engine/`, `app/`.

**Interfaces to honour.**
- Database `quest`, user `quest`, password `quest` (local only). Schema `public`.
- Tables (snake_case, `id` text primary keys where fiction ids exist, `bigserial` elsewhere, `timestamptz`):
  `teams`, `players`, `colleges`, `hostels` (from fiction, same ids), `users` (id `u-000001`.., handle,
  display_name, college_id, hostel_id, created_at), `matches` (id `m-001`.., season, home_team_id,
  away_team_id, venue, starts_at, status `scheduled|live|completed`), `balls` (match_id, innings 1|2,
  over, ball, batter_id, bowler_id, runs, extras, extra_type, wicket bool, wicket_type, happened_at),
  `fantasy_teams` (id, user_id, match_id, created_at), `fantasy_team_players` (fantasy_team_id,
  player_id, is_captain, is_vice), `contests` (id, match_id, name, scope `hostel|college|open`,
  scope_id, entry_points, max_entries), `contest_entries` (id, contest_id, user_id, fantasy_team_id,
  points), `wallet_transactions` (id, user_id, delta, reason, ref, created_at), `wallets` (user_id,
  balance), `outbox` (id bigserial, aggregate text, aggregate_id text, op `insert|update|delete`,
  payload jsonb, created_at, published_at null).
- Sizes (deterministic, seeded PRNG, fixed seed `quest-2026`): 20,000 users across the 12 colleges and
  48 hostels; 60 matches (double round robin minus playoffs, 40 `completed` with full ball-by-ball of
  about 240 balls each, 2 `live`, rest `scheduled`); each user has fantasy teams for roughly 10 of the
  completed matches (≈200,000 teams, ≈2.2 M `fantasy_team_players` rows); ≈200,000 contest entries;
  ≈100,000 wallet transactions; every user a wallet. The three fame > 95 players are picked by 60 to 80%
  of teams (they are the hot keys). Commit the generated SQL; it must use `COPY ... FROM STDIN` so the
  whole seed loads in under 60 s on an M-series Mac.
- **Deliberately slow:** no index on `fantasy_team_players.player_id`, none on `contest_entries.user_id`,
  none on `balls.batter_id`/`bowler_id`. `004-slow-by-design.sql` holds a comment block explaining this
  is intentional and names the query the app will run for `GET /app/players/:id/stats`: season
  batting/bowling aggregates from `balls` plus "selected by % of teams" and "points in last 5 matches"
  from `fantasy_team_players`. Provide that query as a SQL function `player_stats(p_id text)` returning
  one row, so the app (P0-07) calls exactly it. Target: p50 over 150 ms single-threaded on an M-series
  Mac; measure and record the number in the README and the handoff.
- **Outbox:** `003-outbox.sql` creates the table and `AFTER INSERT OR UPDATE OR DELETE` triggers on
  `players`, `teams`, `matches`, `contests` writing one row per change with the full new row (or old
  row on delete) as `payload`. Index on `(published_at) WHERE published_at IS NULL`.
- Fiction ids are the database ids. `players` carries every fiction field including `fame` and `nickname`.

**Work.**
1. Schema SQL with comments on every table (one line each, what it is in the story).
2. `postgres/seed/generate.mjs`: reads `fiction/*.json`, simulates the season (toss, innings, realistic
   run distributions by player role and stats, wickets, extras), builds users with Indian handles and
   names (reuse the fiction name pools; no real people), teams, contests, entries, wallet history
   consistent with balances; writes `002-seed.sql` as `COPY` blocks. Deterministic: run twice, identical
   file. Document how to regenerate.
3. `scripts/check/P0-04.sh`: start `postgres:16` (arm64) as a throwaway container with `postgres/init`
   mounted, on a random free port, wait for `pg_isready`; time the init (must be under 60 s after the
   container reports ready; print it); assert row counts within 5% of the targets; assert the three hot
   players' selection share is between 60 and 80%; run `SELECT * FROM player_stats('<hot id>')` five
   times with `\timing`, print p50, assert over 150 ms; update a player row and assert one new `outbox`
   row with `op = 'update'` and the payload's `id`; run the generator again and `diff` the output against
   the committed seed (must be identical); remove the container. bash 3.2 compatible.

**Acceptance check.** `scripts/check/P0-04.sh` exits 0 and prints every verification with the measured
numbers.

**Handoff complete when.** check passes; `docs/handoffs/P0-04.md` written with the check output, the
measured load time and query latency, the exact hot player ids and a few sample user ids that levels can
rely on; no files outside "Files owned" changed.

**Model.** sonnet
