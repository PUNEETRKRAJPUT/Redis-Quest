# C1: Chapter 1 content, "The keyspace" (16 levels)

**Goal.** Every core Redis data structure as a feature of the fantasy-cricket app, one level each, in the
fiction's voice, validated by the schema, with reference and wrong solutions. After this chapter the
learner has touched strings, counters, expiry, hashes, SCAN, lists, sets, sorted sets, bitmaps,
HyperLogLog, geo, streams, JSON, has made a structure choice under pressure, has lost everything to
FLUSHALL and restored it, and has written the first ten lines of code.

**Depends on.** P0-05 (with Follow-up 1), C0 (match its shape and tone).

**Files owned.** `levels/ch1-keyspace/**`, `scripts/check/C1.sh`.

**Must not touch.** anything else. Schema or engine gaps go in the handoff.

**Source of truth.** `docs/redis-docs-digest.md` for every command, option, complexity note and number
(the data-types sections, the keyspace page, the memory FAQ figures); `docs/fiction.md` and
`fiction/*.json` for names; `docs/handoffs/P0-04.md` for seed ids a level may mention (users u-000001,
u-000010, hot players p-028 Ganapathi Chengappa, p-101 Jithin Varghese, p-151 Hitesh Bhatt; cold p-001
Jignesh Rathod); `levels/README.md` for the format; `levels/ch0-boot` for shape and tone. Never invent.

**Levels.** Follow `docs/PLAN.md` section 5, "Chapter 1: The keyspace" table, level by level (1.1 to
1.16), with these bindings:
- Incident thread in `chapter.yaml` (id `ch1`, title "The keyspace"): registration opens for the home
  college's hostels tonight; the roommate wants to "just put everything in one big JSON file"; the senior
  wants a scoreboard by tomorrow; the warden's nephew is user number one.
- Key naming from the first level: `user:<id>:...`, `otp:<id>`, `wallet:<id>`, `fav:<id>`, `feed:<id>`,
  `lb:hostel:<hostel-id>`, `login:<id>:<yyyy-mm>`, `visitors:match:<match-id>`, `stadiums`,
  `match:<match-id>:balls`, `player:<player-id>` (JSON). Levels use the learner's own id via
  `{{player.id}}` where the plan says 1001, and real seed ids for others.
- Level 1.4 (fifty roommates): `setup` seeds fifty `user:*` hashes under a `ch1:` safe prefix is NOT
  allowed by the schema (`setup` refuses nothing but `game:*`, so `user:c1-001` .. `user:c1-050` hashes
  are fine); verify with an `answer` whose expected is a read-only count (`SCAN` is not an aggregate;
  use `DBSIZE` difference or an `EVAL_RO`-free approach: simplest is `answer` expecting the literal count
  via a `redis` check that `EXISTS user:c1-050` equals 1 plus an `answer` with `expected.cmd:
  [SCARD, "ch1:users"]` where setup also `SADD`s the fifty ids into `ch1:users`). Choose the cleanest
  valid expression and say so in the handoff.
- Level 1.7 antipattern: a healthy-state check `EXISTS lb:hostel:{{env.HOME_HOSTEL}}:list` equals 0 is
  awkward; instead use `TYPE lb:hostel:h-c-02-1` equals `zset` as the `redis` check and an `antipattern`
  check `EXISTS lb:hostel:h-c-02-1:list` equals 0 with the "This passes today, but a list cannot rank"
  message, matching the works-but-wrong solution that builds a list.
- Level 1.10: cite the digest's HyperLogLog figures (up to 12 KB, 0.81% standard error) and the memory
  FAQ figures only as the docs state them.
- Level 1.11: longitude first in `GEOADD`; use three real Indian cities' approximate coordinates from
  `fiction/teams.json` home grounds if present, otherwise mark coordinates as fictional stadium positions.
- Level 1.12: `XADD match:m-041:balls * over 1 ball 1 runs 4 ...` on a live match id; `XLEN` gte 6.
- Level 1.13: JSON player card for `player:p-028` built by the learner; `JSON.GET player:p-028 $.role`.
- Level 1.14 (decision): eight scenarios graded against the digest's compare-data-types decision tree,
  two with the answer "a string", one "not Redis".
- Level 1.15 (FLUSHALL): verify with `event custom progress_restored` (the engine emits it on
  `POST /api/progress/restore`) and `redis` `EXISTS game:player:{{player.id}}` equals 1; the wrong
  solution is doing nothing after FLUSHALL.
- Level 1.16 (code): slot `onboarding.registerUser`, signature `(deps, user)`, fixtures reset the keys,
  behavior assertions call it once and check side effects with `redis` checks (`TYPE user:<id>` hash,
  `SISMEMBER`, `ZSCORE lb:hostel:<hostel> <id>` equals 0); wrong = writes only the hash; works-but-wrong
  = three separate commands without `multi()` (behavior-shaped antipattern with `concurrency`), if you can
  express it, else leave it as `wrong` and note the gap.
- Each level: story (6 to 12 lines, in-world), brainstorm with `not-redis` and at least one reasonable
  option, teach (8 to 20 lines, one `docs` link), task, two to three hints, `show_me` from `kv_card`,
  `hash_card`, `list_feed`, `set_chips`, `leaderboard_panel`, `ttl_timer`, `bitmap_streak`, `hll_counter`,
  `geo_map`, `stream_log`, `json_tree`, `cache_stats`; `reward.xp` 15 to 40; every level at least one
  wrong solution with `because`.

**Check.** `scripts/check/C1.sh`: shared build; `levels:validate levels/ch1-keyspace` clean; 16 level
files; every referenced solution and fixture file exists and is non-empty; each level has a `docs` link;
teach 8 to 20 lines; prints each level id.

**Handoff complete when.** check passes; `docs/handoffs/C1.md` written with one line per level (verify
and solutions), the check output, the expression chosen for 1.4 and 1.16, every gap, and `git status
--short` proving only owned paths changed.

**Model.** sonnet
