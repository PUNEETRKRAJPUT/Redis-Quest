# A-01: app work Chapter 2's remaining levels need

**Goal.** Give levels 2.7 (prefetch cache fed by CDC), 2.8 (sessions with logout-all) and 2.10 (Redis
down, app stays up) the app-side plumbing they need, plus the 429 counting the limiter panel wants.

**Files owned.** `app/` (routes, slots registry, new background workers, tests), `packages/shared/src/learner/`
only for the fail-fast client options (and `deps.ts` defaults), `scripts/check/A-01.sh`. Also allowed:
one new section in `docs/handoffs/P0-07.md` is NOT to be edited; write your own handoff.

**Must not touch.** engine, runner, ui, levels, scenarios, docker files, postgres/.

**Work.**
1. **Outbox drainer** (`app/src/workers/outbox.ts`): every instance polls Postgres `outbox` rows with
   `published_at IS NULL` once a second (ordered by id, batches of 100), `XADD legacydb:changes
   MAXLEN ~ 10000 * aggregate <a> aggregate_id <id> op <op> payload <json>` and marks them published in
   the same transaction order (use `SELECT ... FOR UPDATE SKIP LOCKED` so two instances never publish
   the same row twice). Runs only while the engine's app-config lists the slot `prefetch.applyChange`
   as active OR env `APP_OUTBOX_ALWAYS=1`. Log one line per batch.
2. **Prefetch slots.** Keep `prefetch.getFixtures (deps)` (read path). Add `prefetch.bulkLoad (deps,
   rows)`: called once when the slot is activated (and on `POST /app/prefetch/reload`), `rows` being the
   full `matches` table joined with team names; the baseline does nothing. Add `prefetch.applyChange
   (deps, event)` where `event = { aggregate, aggregateId, op, payload }` from the stream; a provided
   consumer loop in the app (`app/src/workers/changes.ts`) reads `legacydb:changes` with `XREAD BLOCK`
   from `$` per instance and calls the slot when active; the baseline does nothing. Expose
   `GET /app/fixtures` through `prefetch.getFixtures`; the baseline reads Postgres.
3. **Sessions.** Add `session.destroy (deps, sid)` and `session.destroyAll (deps, userId)` slots with
   in-memory baselines, routes `POST /app/logout` (cookie) and `POST /app/logout-all { userId }`. Keep
   `session.create (deps, user)` and `session.get (deps, sid)`.
4. **Fail-fast learner Redis client.** In `createLearnerDeps` default `disableOfflineQueue: true` and a
   per-command timeout (node-redis supports an AbortSignal per command; wrap the proxied client so every
   command races a `LEARNER_REDIS_COMMAND_TIMEOUT_MS` default 2000) so that when Redis is down a learner's
   `redis.hGetAll` rejects within two seconds instead of queueing forever. Document the error the learner
   sees (`name`, `message`) so level 2.10 can teach the catch. The app's own baseline paths must never
   touch Redis, so they keep working with Redis down.
5. **429 counting (F-11).** Per-route metrics gain `denied` (count of 429 responses) pushed to the engine
   (additive field); the engine ignores unknown fields today, which is fine.

**Check.** `scripts/check/A-01.sh` in project `quest-p07` with `.env.p07`: start the stack with
`APP_OUTBOX_ALWAYS=1`; update a player row via psql and see one entry appear on `legacydb:changes`
within 3 s with `op=update`; activate `prefetch.applyChange` with a test learner file (copied into
`workspace/ch2/prefetch-apply.js`) that writes `cache:match:<id>` hashes, update a match, assert the
hash changes within 2 s; activate `prefetch.bulkLoad` with a test file and assert `cache:match:*` keys
equal the matches count; login, `/app/me`, logout, `/app/me` → 401, logout-all; `docker compose -p
quest-p07 stop redis`, call `/app/players/p-028/stats` with the reference cache-aside learner file active
and assert it returns 500 within 3 s (learner path fails fast) while `/app/players/p-001` (baseline, no
Redis) still returns 200; `start redis` again and assert recovery; 429s counted in the pushed metrics;
`down -v`.

**Handoff.** `docs/handoffs/A-01.md`: the new slot table with signatures, the stream entry format, the
fail-fast error shape, and the check output.

**Model.** sonnet
