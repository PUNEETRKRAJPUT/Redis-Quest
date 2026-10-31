# P0-05: Level file schema, loader, validator

**Goal.** Define the one file format every level is written in, with a strict validator that fails CI
with a file and line, and a loader the engine uses. Everything content-related in the project hangs off
this schema, so it is designed once, carefully.

**Depends on.** P0-01

**Files owned.**
- `packages/shared/src/levels/` (schema, types, loader, templating helpers, tests)
- `packages/shared/src/index.ts` (add exports; keep the P0-01 placeholders)
- `packages/shared/package.json` (add `zod`, `yaml`, and a `levels:validate` bin/script)
- `levels/README.md` (replace the P0-01 placeholder with the authoring guide)
- `levels/_examples/` (one valid level per mode plus deliberately invalid files used by tests)
- `scripts/check/P0-05.sh`

**Must not touch.** `engine/`, `app/`, `runner/`, `ui/`, other `packages/shared` files, `docs/`.

**Interfaces to honour** (read `docs/PLAN.md` sections 4, 4b and 5 first; this spec refines them).
- Layout: `levels/<chapter-dir>/<NN>-<slug>.yaml`, chapter dirs `ch0-boot`, `ch1-keyspace`,
  `ch2-everyone-showed-up`, `ch3-compete-and-talk`, `ch4-background`, `ch4b-on-call`, `ch5-survive`,
  `finale`. Level id = `<chapter>-<NN>-<slug>` and must equal the file name. Chapter dir has
  `chapter.yaml` (id, title, incident thread as a list of `{from, time, text}` messages, order of levels).
- Long markdown fields (`story`, `teach`, `task`) may be inline or `{ file: ./02-strings.story.md }`
  relative to the level file; the loader inlines them and records the source path for error messages.
- Required fields: `id`, `chapter`, `title`, `mode` (`cli|code|ops|decision`), `story`, `brainstorm`
  (`prompt`, `options` list each `{ id, label, is_reasonable: bool }`, free-text allowed), `teach`,
  `task`, `verify` (non-empty list), `reward` (`xp`, optional `badge`), `solutions`.
  Optional: `setup` (list of `{ cmd: [..] } | { sql: "..." } | { script: path }`), `scenario`, `hints`
  (ordered list), `show_me` (component id), `docs` (list of official URLs; must start with
  `https://redis.io/docs/`), `min_redis_version`.
- `verify` entries are a discriminated union on `type`:
  - `redis`: `checks: [{ cmd: [..], <assertion> }]`; assertions exactly one of `equals`, `notEquals`,
    `gte`, `lte`, `between: [a,b]`, `exists: bool`, `matches: regex`, `oneOf: [..]`, `lengthGte`,
    `contains`. Each check may carry `message` (shown on failure). Commands run read-only; the validator
    rejects write commands (`SET`, `DEL`, `FLUSH*`, `HSET`, `LPUSH`, `ZADD`, `XADD`, `CONFIG SET`, ...)
    with an allowlist of read commands, overridable per check with `allowWrite: true` and a reason.
  - `antipattern`: same shape as `redis`; a hit produces the "works, but wrong" verdict with its `message`.
  - `behavior`: `slot`, `fixtures: path`, `assertions: [{ call: {args}, expect | expectError |
    sideEffect: redis-check }]`, `concurrency` (optional).
  - `traffic`: `scenario` (id), `baseline: bool`, assertions from `p99_ratio_lte`, `rps_ratio_gte`,
    `db_calls_ratio_lte`, `hit_ratio_gte`, `error_rate_lte` (ratios are against the recorded baseline run
    of the same scenario).
  - `event`: `kind` (`redis_disconnect`, `redis_reconnect`, `channel_message`, `key_expired`,
    `service_scaled`, `custom`), `match` (object), `timeoutMs`.
  - `quiz`: `question`, `options: [{id, label}]`, `correct: id | [ids]`, `explanation`.
- `solutions`: `{ reference: path, wrong: [{ path, expect: 'wrong' | 'works_but_wrong', because }] }`,
  paths relative to the level file; for `cli` and `ops` levels the paths point at `.redis` command
  scripts or `.sh` files; for `decision` levels `reference` is the correct option id and `wrong` lists
  option ids. The validator checks the files exist.
- Templating: `{{player.id}}`, `{{player.name}}`, `{{level.id}}`, `{{chapter.id}}`, `{{env.X}}` in
  any string; the loader exposes `render(template, ctx)`; the validator rejects unknown variables.
- Verdict rule (document in the README, implement as a pure function `verdict(results)`):
  any failing `redis|behavior|traffic|event|quiz` → `wrong`; all pass but any `antipattern` hit →
  `works_but_wrong`; else `right`.
- Unknown keys anywhere are errors. Error output: `levels/ch1-keyspace/07-leaderboard.yaml:23:5 verify[0].checks[1]: exactly one assertion required`.

**Work.**
1. Zod schemas + inferred TypeScript types exported from `@quest/shared` (`LevelFile`, `Chapter`,
   `VerifySpec`, `Verdict`, `renderTemplate`, `loadChapter`, `loadAllLevels`, `validateLevels`).
2. Loader: parse with `yaml` keeping positions (LineCounter) so errors carry line and column; inline
   `file:` markdown; resolve and existence-check solution paths; enforce id = filename and chapter order.
3. `levels:validate` script (`node dist/levels/cli.js [dir]`) printing all errors, exit 1 if any.
4. `levels/_examples/`: `example-cli`, `example-code`, `example-decision`, `example-ops` chapters each
   with one complete, realistic level (use the fantasy-cricket world; real Redis commands from
   `docs/redis-docs-digest.md`), plus `invalid/` cases: unknown key, two assertions, write command without
   `allowWrite`, missing solution file, id mismatch, unknown template variable, bad docs URL.
5. Tests (vitest) covering every invalid case and the verdict function.
6. `levels/README.md`: authoring guide for level writers with a full annotated example, the seven beats
   mapped to fields, the verdict rule, the templating variables, and "how to run the validator".
7. `scripts/check/P0-05.sh`: build shared, run its tests, run the validator on `levels/_examples`
   (valid pass, each invalid file fails with a file:line), print results.

**Acceptance check.** `scripts/check/P0-05.sh` exits 0.

**Handoff complete when.** check passes; `docs/handoffs/P0-05.md` written with the check output and a
list of every schema decision you made that the plan left open; no files outside "Files owned" changed.

**Model.** opus. The schema is the contract for ~90 levels and for the verifier engine; mistakes here
cost more than anywhere else.
