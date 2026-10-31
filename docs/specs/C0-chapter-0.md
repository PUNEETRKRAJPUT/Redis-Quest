# C0: Chapter 0 content, "Boot" (5 levels)

**Goal.** The first five levels a real beginner meets, written in the fiction's voice, validated by the
schema, with reference and wrong solutions, so the platform has real content to be tested against and
so that the five testers can start.

**Depends on.** P0-05 (plus its Follow-up 1: the `answer` verifier), P0-06 (event names, `game:*` mirror
keys, `game:engine:boots`), P0-11 (Insight is pre-connected, so 0.4 no longer adds a database).

**Files owned.** `levels/ch0-boot/**`, `scripts/check/C0.sh`.

**Must not touch.** anything else. Ask for schema or engine changes in the handoff.

**Source of truth for every fact.** `docs/redis-docs-digest.md` for Redis; `docs/fiction.md` and
`fiction/*.json` for names and voice; `docs/handoffs/P0-06.md` for what keys the engine writes
(`game:player:<id>` hash, `game:progress`, `game:welcome:gift` with a 24 h TTL, `game:engine:boots`);
`levels/README.md` for the format. Never invent a command, option or statistic.

**Levels** (ids `ch0-01-...` to `ch0-05-...`; `chapter.yaml` id `ch0`, title "Boot", incident thread of 6 to
10 WhatsApp-style messages between `you`, `roommate` and `senior` about "bhai it works on my laptop"):

| # | title (yours may differ) | mode | verify | solutions |
|---|---|---|---|---|
| 01 | Bhai, it works on my laptop | ops | `event custom ui_connected` (already happened) and `redis` check `GET game:engine:boots` gte 1 | reference `.sh` = `./scripts/start`; wrong `.sh` = `docker compose up redis` only, `because` the game never comes up |
| 02 | Say hello | cli | `event custom cli_ping` | reference `.redis` = `PING`, `INFO server`, `DBSIZE`; wrong = `INFO server` only |
| 03 | Find your save file | cli | `answer` whose expected is `HGET game:player:{{player.id}} name` (`compare: equals`), plus `redis` `TYPE game:player:{{player.id}}` equals `hash` | reference `.redis` = `KEYS game:*`, `TYPE ...`, `HGETALL ...`; wrong = `GET game:player:{{player.id}}` (WRONGTYPE) |
| 04 | The second window | ops | `answer` with expected `TTL game:welcome:gift`, `transform: number`, `compare: numeric_within`, `tolerance: 600` | reference `.sh` = `open http://localhost:5540`; wrong `.sh` = opening 8001, `because` that was the old Stack bundle port |
| 05 | Roommate ran `down` | ops | `redis` `GET game:engine:boots` gte 2 and `EXISTS game:player:{{player.id}}` equals 1 | reference `.sh` = `docker compose down && ./scripts/start`; wrong `.sh` = `docker compose down -v`, expect `wrong`, `because` the volume and the save file are gone (and the game restores from the progress file) |

Every level: `story` as a short in-world scene (the roommate, the senior), a `brainstorm` with `not-redis`
and a reasonable option, a `teach` panel of 8 to 20 lines with one `docs` link, a precise `task`, two to
three `hints`, `show_me` from this list: `kv_card`, `hash_card`, `ttl_timer`; `reward.xp` 10 to 30; level
03 also teaches that `KEYS` is for debugging only and that `SCAN` arrives in Chapter 1. Tone per
`docs/fiction.md`. Quote every YAML value that starts with `{{`.

**Check.** `scripts/check/C0.sh`: `pnpm --filter @quest/shared build` then `levels:validate levels/ch0-boot`
passes; every `.redis` and `.sh` solution file referenced exists and is non-empty; each `teach` has at
least one `docs` link; prints each level id. (Running the solutions against a live Redis is P0-09's check.)

**Handoff complete when.** check passes; `docs/handoffs/C0.md` written with the check output and any
schema or engine gap you hit; no files outside "Files owned" changed.

**Model.** sonnet
