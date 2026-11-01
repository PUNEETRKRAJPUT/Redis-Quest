# Writing levels

Every level in the game is one YAML file. The engine reads it, the verifier engine grades the
learner against it, and CI proves its reference and wrong solutions behave as declared. This
guide is the contract; the schema that enforces it lives in `packages/shared/src/levels/`.

Working examples, one per mode, are in `_examples/` (`example-cli`, `example-code`,
`example-decision`, `example-ops`). `_examples/invalid/` holds deliberately broken files the
tests use. Copy an example rather than starting from a blank file.

## Layout

```
levels/
  ch1-keyspace/
    chapter.yaml                     chapter id, title, incident thread, level order
    07-hostel-scoreboard.yaml        one level
    07-hostel-scoreboard.story.md    optional: long markdown pulled in with { file: ... }
    solutions/07-reference.redis     reference and known-wrong solutions
    fixtures/07-reset.yaml           optional: behavior verifier fixtures
```

- Chapter directories: `ch0-boot`, `ch1-keyspace`, `ch2-everyone-showed-up`,
  `ch3-compete-and-talk`, `ch4-background`, `ch4b-on-call`, `ch5-survive`, `finale`. Their chapter
  ids are the part before the first dash: `ch0` ... `ch5`, `ch4b`, `finale`.
- Level files are named `NN-slug.yaml`: a two-digit number and a kebab-case slug.
- **Level id = `<chapter id>-<NN>-<slug>`**, e.g. `ch1-07-hostel-scoreboard` in
  `ch1-keyspace/07-hostel-scoreboard.yaml`. The validator rejects any other id.
- Directories starting with `_` or `.` are skipped when the validator walks `levels/`, so
  `_examples` never shows up in the game.
- Every relative path is relative to **the file it is written in**, uses forward slashes, and
  must stay inside the levels tree (`levels/` for real chapters).

## chapter.yaml

```yaml
id: ch1                      # must be the canonical id for a canonical directory
title: "The keyspace"
incident:                    # the WhatsApp-style thread that opens the chapter
  - from: roommate           # a cast slug from fiction/cast.json, or "you"
    time: "21:58"            # 24-hour, quoted
    text: "bhai the hostel group wants a scoreboard by tonight"
levels:                      # every level file, exactly once, in file-number order
  - ch1-01-a-name-and-an-otp
  - ch1-07-hostel-scoreboard
```

## A complete level, annotated

This is `_examples/example-cli/01-hostel-scoreboard.yaml`, trimmed only in the prose.

```yaml
id: example-cli-01-hostel-scoreboard   # <chapter id>-<file name>; example chapters use their full directory name as id
chapter: example-cli                   # must equal chapter.yaml id
title: "The hostel scoreboard"
mode: cli                              # cli | code | ops | decision

story: { file: ./01-hostel-scoreboard.story.md }   # markdown inline, or from a file next to the level

brainstorm:                            # beat 3: commit to a guess before any teaching
  prompt: "Five people, one score each, ranked. Which structure would you reach for, and why?"
  options:                             # at least two; must include id: not-redis; at least one reasonable
    - { id: sorted-set, label: "A sorted set", is_reasonable: true }
    - { id: list-sorted-in-app, label: "A list, sorted in the app", is_reasonable: false }
    - { id: not-redis, label: "Not Redis: ORDER BY in Postgres", is_reasonable: true }

teach: |                               # beat 4: concept, commands, a worked example that is NOT the answer
  A **sorted set** keeps unique members ordered by a numeric score ...

task: |                                # beat 5: exactly what to do, with the key names
  The key is `lb:hostel:h-c-02-2`. Add yourself as member `user:{{player.id}}` with 120 points ...

setup:                                 # optional; runs before the level starts; must be idempotent
  - cmd: [DEL, "lb:hostel:h-c-02-2", "lb:hostel:h-c-02-2:list"]
  - cmd: [ZADD, "lb:hostel:h-c-02-2", 140, "user:teja"]

hints:                                 # optional; revealed one at a time, in this order
  - "ZADD takes the score before the member."

verify:                                # beat 6; runs in list order
  - type: redis
    checks:
      - cmd: [TYPE, "lb:hostel:h-c-02-2"]
        equals: zset
        message: "lb:hostel:h-c-02-2 is not a sorted set any more."   # shown when this check fails
      - cmd: [ZSCORE, "lb:hostel:h-c-02-2", "user:{{player.id}}"]
        equals: 150
        message: "Your score should be 150. If it is 30, the second ZADD replaced it."
  - type: antipattern                  # checks describe the HEALTHY state; a failing check is a hit
    checks:
      - cmd: [EXISTS, "lb:hostel:h-c-02-2:list"]
        equals: 0
        message: "This passes today, but you also keep a list copy of the board ..."

show_me:                               # optional; what lights up on "right", and which keys it displays
  component: leaderboard_panel         # UI component id
  keys: ["lb:hostel:h-c-02-2"]          # templated like any text; one panel per key
docs:                                  # optional; official pages only
  - https://redis.io/docs/latest/develop/data-types/sorted-sets/
reward:
  xp: 50
  badge: "Ranked"                      # optional

solutions:                             # beat 7, and the CI proof of every verifier
  reference: solutions/01-reference.redis
  wrong:                               # at least one
    - path: solutions/01-wrong-zadd-twice.redis
      expect: wrong
      because: "The second ZADD replaces the score instead of adding to it."
    - path: solutions/01-works-but-wrong-list-copy.redis
      expect: works_but_wrong
      because: "Correct sorted set, plus a list copy that will drift."
```

## Field reference

| field | required | notes |
|---|---|---|
| `id` | yes | `<chapter id>-<NN>-<slug>`, equal to the file name |
| `chapter` | yes | the chapter id from `chapter.yaml` |
| `title` | yes | short, in-world |
| `mode` | yes | `cli`, `code`, `ops` or `decision`: the main way the learner builds. A level can still mix verifiers (an `ops` level with a `quiz`) |
| `story` | yes | markdown, or `{ file: ./x.md }` |
| `brainstorm` | yes | `prompt`, `options: [{ id, label, is_reasonable }]`. The learner always writes one free-text line as well; there is no field for it |
| `teach` | yes | markdown, or `{ file: ./x.md }`. Optional only on a `code` level that sets `interview` |
| `task` | yes | markdown, or `{ file: ./x.md }` |
| `verify` | yes | non-empty list of verifiers (below). Empty or absent only on a pool level (`interview.pool`), whose checks come from the drawn level |
| `reward` | yes | `xp` (positive integer), optional `badge` |
| `solutions` | yes | see "Solutions". Absent on a pool level (the drawn level has them) |
| `setup` | no | list of `{ cmd: [...] }`, `{ sql: "..." }` or `{ script: path }` |
| `scenario` | no | load scenario id for the live pain panel (e.g. `toss-time-100`) |
| `hints` | no | ordered list of strings |
| `show_me` | no | `{ component, keys, title? }`, see below; a bare component id is still accepted |
| `interview` | no | `code` levels only: makes the level a timed blank rebuild (`rebuild_of`) or a drawn one (`pool`), see "Interview levels" |
| `docs` | no | URLs starting with `https://redis.io/docs/` |
| `min_redis_version` | no | quoted, e.g. `"8.4"`, for commands that need it |

`show_me` names the UI component (snake_case id) and the Redis keys it displays. `keys` may use
templates (`{{player.id}}`), are read through the UI's read-only CLI proxy (one panel per key), and may
be empty when nothing in Redis is worth showing. The short form `show_me: kv_card` is kept for compatibility:
the loader normalises it to `{ component: kv_card, keys: [] }`. `title` is an optional heading. Prefer
the object form: with no keys the UI has nothing to display and asks the learner which key to read.

Unknown keys are errors everywhere, including inside verifiers. There is no `unlocks` field:
`chapter.yaml` order decides what comes next.

Rules that cut across fields:

- A `decision` level needs at least one `quiz`; a `code` level needs a `behavior` or `traffic` (a pool level draws one).
- An `antipattern` verifier needs at least one `works_but_wrong` solution, and a
  `works_but_wrong` solution needs an `antipattern` verifier (each detector is proven to fire).
- `setup` and fixtures may not run `FLUSHALL`, `FLUSHDB` or `SHUTDOWN`, and may not touch any key
  starting with `game:`. That prefix belongs to the engine (the learner's save file).

## Interview levels

A `code` level can be a timed blank rebuild of an earlier level (PLAN.md section 5, "Interview mode"):

```yaml
interview:
  minutes: 10                          # 5 to 60, whole minutes
  rebuild_of: example-code-01-cache-aside   # the guided level this repeats
  hint_xp_cost: 10                     # whole XP per hint, default 10
```

- Leave `teach` out. The UI replaces the Teach beat with one line, "no teaching here: this is the
  interview", and the engine never sends `teach` for an interview level. If you write one anyway, it is not shown.
- `rebuild_of` must be a level in the same chapter that is listed before this one, or in an earlier chapter
  (canonical chapter order). The check needs the whole tree, so the engine's loader does it, and so does the
  validator when you pass every directory involved:
  `node packages/shared/dist/levels/cli.js levels/_examples/example-code levels/_examples/example-interview`.
  Validating the interview chapter alone reports that `rebuild_of` was not loaded.
- The verifiers are the same kind as any code level; the timer never changes the verdict. The clock starts when
  the level is first started, a verify after the deadline still grades and is marked overtime, each hint
  subtracts `hint_xp_cost` from the learner's XP (never below 0), and a pass records "rebuilt in m:ss".
- Write the task in interview wording ("Design a ... that ...") and keep hints few; they cost XP here.
- A full example is `levels/_examples/example-interview/`.

### Interview pools: the interviewer picks

`interview.pool` replaces `rebuild_of` when the level should draw its use case at random from earlier levels:

```yaml
interview:
  minutes: 20
  hint_xp_cost: 20
  blank_start: true                 # optional; default true for a pool level, false for a rebuild_of level
  pool:                             # 2 to 12 entries, each rebuild_of once
    - rebuild_of: ch2-02-cache-aside-v1
      questions:                    # 1 to 5 follow-up quizzes, asked after the rebuild's own checks
        - type: quiz
          question: "Redis restarts and comes back empty. What happens to your page?"
          options:
            - { id: refills, label: "It refills from Postgres on the next misses, slower for a while" }
            - { id: errors, label: "Every request fails until the cache is reloaded by hand" }
          correct: refills
          explanation: "A miss reads the source of truth and writes the entry back."
    - rebuild_of: ch3-03-token-bucket
      questions: [...]
```

- Exactly one of `rebuild_of` and `pool`. A pool entry is a quiz written as in "quiz" below (the same fields and
  rules), with option ids unique across the questions of that entry.
- A pool level is a `code` level whose own `verify` is **empty or absent** and whose `solutions` is **absent**: its
  checks and solutions are the drawn level's. `task` is still required but the learner never sees it (they see the
  drawn level's task), and `show_me`, `docs`, `scenario` and `min_redis_version` are likewise taken from the drawn
  level. `story`, `brainstorm`, `hints`, `title` and `reward` are the pool level's own; its hints come first and the
  drawn level's hints follow, all at `hint_xp_cost`. Leave `teach` out.
- Every `rebuild_of` in a pool must be a **code** level that is not itself a pool level, and must come earlier (same
  chapter, listed before, or an earlier chapter), exactly as for `rebuild_of`. The validator reports a wrong one with
  the position of that entry (`interview.pool[1].rebuild_of`).
- **The draw.** At the first start the engine picks one entry, seeded by the player id and the level id (the same save
  always draws the same way), skipping entries that this player drew in other pool levels (when every entry is taken,
  repeats are allowed). The pick is stored and never changes: starting again or restarting the engine keeps it.
  Three pool levels over the same nine entries therefore give three different use cases.
- **Blank start.** With `blank_start: true` the engine moves each slot file of the drawn level that is not empty to
  `<file>.before-<pool level id>` (`-2`, `-3` if that name exists; a backup is never overwritten) and leaves an empty
  file, once. The level payload lists `blanked: [{ file, backup }]` so the page can say where the learner's own earlier
  file went. `blank_start: false` leaves the file alone. On a `rebuild_of` level the default is `false`, so the
  existing interviews play exactly as before; `true` there blanks the slot files of the level it rebuilds.
- **Grading.** The pool level is graded as the drawn level (its fixtures resolve from its directory, its slots, its
  scenario and its verifiers), then the entry's questions are asked, with answer indices that continue after the drawn
  level's checks. A wrong answer to a question makes the verdict `wrong`, like any failed quiz. "The ideal way" is the
  drawn level's.
- The grading harness plays the drawn level's own solutions (see `docs/grading.md`).

## The portfolio page

`GET /api/portfolio` answers `{ markdown, stats }`: a page built from the learner's save (`progress.json`), the level
files and the workspace, never from anything else. `POST /api/portfolio/write` writes it to `workspace/PORTFOLIO.md`,
answers `{ path, file, bytes, levels, passed }` and emits the level event `custom portfolio_written`
with `{ bytes, levels, passed }` (`levels` is all levels in the game, `passed` the learner's). A level can wait for it:

```yaml
- type: event
  kind: custom
  match: { name: portfolio_written }
  timeoutMs: 120000
```

The page has a title with the player's name, XP and badges; per chapter the passed levels with one line each (for a
traffic level the stored before and after numbers, for an interview "rebuilt in m:ss", for a pool level the drawn use
case); the learner's brainstorm lines; the workspace files with sizes (no `.before-` backups, no `_bundle-*` shims,
not the page itself); and "What I would say in an interview". Every number is read from the save and every sentence
names its level; where the save has no number for a level, the line has none. The numbers come from the traffic check
of the verify that passed (`metrics` on the stored verdict). The UI offers it as "Write my story" on "What you built".

## The seven beats

| beat (PLAN.md 4b) | field |
|---|---|
| 1. Scenario | `chapter.yaml` `incident` (the thread) and the level's `story` |
| 2. What already exists | written into `story`; the live pain panel comes from `scenario` |
| 3. Brainstorm | `brainstorm` |
| 4. Teach | `teach`, `docs` |
| 5. Build | `task`, `setup`, `hints`, and `mode` (what kind of build) |
| 6. Verify | `verify` and each check's `message` |
| 7. The ideal way | `solutions.reference` (annotated with comments), `show_me`, `reward` |

## Verifiers

### `redis` and `antipattern`

```yaml
- type: redis
  checks:
    - cmd: [TTL, "otp:{{player.id}}"]   # an argv list; numbers are fine and are sent as strings
      between: [1, 120]                # exactly one assertion per check
      message: "The OTP should expire within two minutes."
```

Exactly one assertion per check:

| assertion | passes when |
|---|---|
| `equals: v` | the reply equals `v` (see comparison rules) |
| `notEquals: v` | it does not |
| `gte: n` / `lte: n` | the reply, read as a number, is `>= n` / `<= n` |
| `between: [a, b]` | `a <= reply <= b`, as numbers |
| `exists: true` | the reply is not nil and not an empty list (`false`: it is) |
| `matches: "regex"` | the reply, as a string, matches the JavaScript regex (no flags) |
| `oneOf: [v, ...]` | the reply equals one of them |
| `lengthGte: n` | the reply list (or string) has at least `n` elements (characters) |
| `contains: v` | a list reply has an element equal to `v`, or a string reply contains `v` |
| `notContains: "text"` | the negation of `contains`: a string reply (`INFO commandstats`, `CLIENT LIST`) does not contain `text`; a list reply has no element equal to it; nil passes. `text` must not be empty. Failing feedback: `expected no "text"`, and for a multi-line reply the observed part quotes the line that holds it |

Two ways to say "this must not appear in an `INFO` reply": `notContains: cmdstat_keys` (plain text), or
`matches: "^(?![\\s\\S]*cmdstat_keys)"` (a negative lookahead; the JavaScript regex runs without flags, so write
`[\\s\\S]` where you mean "any character including a newline"). Both work on a multi-line string reply; prefer `notContains`.

Comparison rules (the verifier engine implements these): commands are sent raw and replies are
read as RESP2 values: integers, strings, nil, and lists. `null` in a level means nil. When the
expected value is a number, a numeric string reply compares numerically (`ZSCORE` returns
`"150"`, which equals `150`). Lists compare element by element. A flat `HGETALL` reply is a list
of field, value, field, value, so prefer `HLEN` or `HGET` over asserting on `HGETALL`.

**Verifier commands must be read-only.** The validator checks each command against a read-only
allowlist (`packages/shared/src/levels/commands.ts`); anything else, including commands it does
not know, is refused. `CONFIG GET` is allowed, `CONFIG SET` is not. If a check truly has to
write, say so: `allowWrite: true` plus a `reason`.

`antipattern` comes in two shapes, exactly one per entry. Either way its checks or assertions
describe the **healthy** state, each one needs a `message`, and a failing one is the hit: its
message is the "works, but wrong" feedback. Write it as "This passes today, but ..." and say how
it fails at scale.

- **`checks`**, the same shape as `redis` (no list copy of the leaderboard, a TTL on the cache key).
- **behavior shape**: `slot`, `fixtures`, `assertions`, optional `concurrency`, exactly like a
  `behavior` verifier, for antipatterns that only show in how the code behaves. The classic case is
  a read-then-write from JavaScript that is correct one request at a time and races under load
  (`_examples/example-code/02-token-bucket.yaml`):

```yaml
- type: antipattern
  slot: ratelimit.allow
  fixtures: fixtures/02-reset-buckets.yaml
  concurrency: 100
  assertions:
    - call: { args: ["u-limit-2"] }
      repeat: 100
      expectCount: { value: true, lte: 10 }
      message: "This passes one request at a time, but 100 concurrent requests got more than 10 through ..."
```

### `behavior`

Calls the learner's function in the runner (P0-08) through a named slot.

```yaml
- type: behavior
  slot: ratelimit.allow               # a slot from the app's slot registry
  fixtures: fixtures/03-reset.yaml    # steps that reset state before this verifier runs
  concurrency: 50                     # optional: parallel calls for repeated calls (default 1)
  assertions:
    - call: { args: ["u-1"] }         # arguments after deps; the function receives (deps, ...args)
      repeat: 100                     # optional: make this call 100 times
      expectCount: { value: true, equals: 10 }   # exactly 10 of the 100 returned true
    - call: { args: ["u-2"] }
      expect: true                    # deep equality on the return value (every call if repeated)
      sideEffect:                     # redis checks run after the call(s)
        - cmd: [PTTL, "ratelimit:u-2"]
          gte: 1
```

Each assertion uses at most one of `expect`, `expectError` (`true`, or a regex the error
message must match) and `expectCount` (`value` plus one of `equals`, `gte`, `lte`, `between`;
needs `repeat` of 2 or more), and may add `sideEffect`. The fixtures file looks like:

```yaml
steps:
  - cmd: [DEL, "ratelimit:u-1", "ratelimit:u-2"]
```

### `traffic`

```yaml
- type: traffic
  scenario: toss-time-100     # a scenario in scenarios/
  baseline: true              # ratios are against the recorded baseline run of the same scenario
  assertions:                 # at least one
    p99_ratio_lte: 0.2        # p99 at least 5x better than baseline
    rps_ratio_gte: 2
    db_calls_ratio_lte: 0.1   # 90% fewer Postgres calls
    hit_ratio_gte: 0.9        # absolute, not a ratio against baseline
    error_rate_lte: 0         # absolute
    db_queries_lte: 2         # absolute: total Postgres queries during the run (integer)
    p99_ms_lte: 50            # absolute: p99 latency in milliseconds
    redis_per_request_lte: 1  # absolute: Redis commands per app request (the app's own count over the run window)
    redis_calls_ratio_lte: 0.2  # Redis commands per request, as a ratio of the baseline's
```

`baseline: true` means the check is graded against a baseline: the engine records it itself by
running the same scenario with the level's learner slots deactivated (levels never record one).
The four `*_ratio_*` assertions (`p99_ratio_lte`, `rps_ratio_gte`, `db_calls_ratio_lte`, `redis_calls_ratio_lte`) need
`baseline: true`; the absolute ones (`hit_ratio_gte`, `error_rate_lte`, `db_queries_lte`, `p99_ms_lte`,
`redis_per_request_lte`) do not. Both Redis assertions use the app's `redisCommands` counter divided by its request
count over the run window (health probes excluded); `redis_calls_ratio_lte` fails, rather than passes, when the baseline
made no Redis calls (nothing to divide by).

### `event`

```yaml
- type: event
  kind: channel_message       # redis_disconnect | redis_reconnect | channel_message | key_expired | service_scaled | custom
  match: { channel: "score:match:42" }
  timeoutMs: 30000
```

`channel_message` needs `match.channel`, `key_expired` needs `match.key`, `service_scaled` needs
`match.service`, `custom` needs `match.name`. Other `match` fields are passed to the engine as is (looked up in the
event's `data`). Custom events the engine produces itself (E-02): `load_started { scenario, durationSec }` and
`load_finished { scenario, requests, rps, p99Ms, errors }` (the learner ran traffic, with the UI's "Run traffic" button
or `POST /api/load/start`; `match: { name: load_finished, scenario: toss-time-100 }`), `redis_busy { command }` (a
terminal command got a `BUSY` error because a script blocks Redis) and `script_killed { command }` (`SCRIPT KILL` or
`FUNCTION KILL` answered `OK` in the terminal).
Chapter 5's two (E-03): `redis_target_changed { from, to, kind }` (the learner switched the game's Redis target from the
page or with `PUT /api/target`; `from` and `to` are target strings, `kind` is `single`, `sentinel` or `cluster`, the kind
of `to`; `match: { name: redis_target_changed, kind: cluster }`) and `sentinel_failover { masterName, from, to }`
(the engine is on a `sentinel://` target and its client followed a new master: `from` and `to` are `host:port`;
`match: { name: sentinel_failover }`). Both need the compose profiles and a hand on the Docker side, so the grading
harness skips levels that wait for them.
The finale's (E-04): `portfolio_written { bytes, levels, passed }` (the learner pressed "Write my story" on "What you
built", or `POST /api/portfolio/write` wrote `workspace/PORTFOLIO.md`; `match: { name: portfolio_written }`). The grading
harness writes the story itself before verifying a good solution.

### `quiz`

```yaml
- type: quiz
  question: "A live leaderboard of points per hostel, read top ten first."
  options:
    - { id: lb-sorted-set, label: "Sorted set" }
    - { id: lb-list, label: "List, sorted in the app" }
  correct: lb-sorted-set      # or a list of ids when several are correct
  explanation: "It needs ordering by a score, which a sorted set maintains."
```

### `answer`

A typed answer whose expected value is read from Redis when verify runs: "type back the value
of one field", "the TTL you saw", "how many users did SCAN find".

```yaml
- type: answer
  prompt: "What did ZREVRANK return for you?"
  expected:
    cmd: [ZREVRANK, "lb:hostel:h-c-02-2", "user:{{player.id}}"]   # read-only, templated like any check
    transform: number          # string (default) | number | length (list length or string length)
  compare: equals              # equals (default) | numeric_within
  # tolerance: 5               # required with numeric_within, not allowed otherwise
  message: "That is not the rank Redis has for you right now."
```

The engine runs `expected.cmd`, applies `transform`, and compares it with the learner's trimmed
text: `equals` compares as strings (as numbers when the transform is `number` or `length`);
`numeric_within` passes when the difference is at most `tolerance` (use it for values that move,
like a TTL). The command follows the same read-only allowlist as `redis` checks, with no
`allowWrite`. Use `answer` in `cli` and `ops` levels; a `decision` level still needs a `quiz`,
because its solutions name quiz options.

## Solutions

| mode | `reference` | `wrong[]` |
|---|---|---|
| `cli` | a `.redis` file | `{ path: x.redis, expect, because }` |
| `ops` | a `.sh` or `.redis` file | `{ path, expect, because }` |
| `code` | a `.js` (or `.mjs`) module, same contract as `workspace/` files | `{ path, expect, because }` |
| `decision` | the correct option id, or a list of them (one per quiz) | `{ option: <id>, expect: wrong, because }` |

`expect` is `wrong` or `works_but_wrong`. Every level ships at least one wrong solution. `.redis`
files hold one command per line in `redis-cli` syntax, `#` for comments, and may use the
template variables. In a `decision` level option ids are unique across all its quizzes, the
reference lists every correct option, and each wrong entry names an incorrect option.

A `code` level whose verify specs name several slots has one solution path, so each solution is a **bundle**: one
module with a named export per slot (the part of the slot name after the dot: `prefetch.bulkLoad` is `bulkLoad`,
`session.destroyAll` is `destroyAll`) and a default export. `scripts/grade/grade.sh` copies the bundle to
`_bundle-<level-id>-<solution>.js` beside the first slot's workspace file and writes each slot file as a two-line shim
(`import * as bundle from './_bundle-....js'; export default bundle.<name>;`), so the learner-facing contract of one
default export per file is unchanged. See `docs/grading.md`.

CI runs every verifier against the reference (must be `right`), each wrong solution (must give
its declared verdict) and an empty stub (must be `wrong`).

## The verdict rule

Verifiers run in list order, then:

1. any failing `redis`, `behavior`, `traffic`, `event`, `quiz` or `answer` verifier: **wrong**;
2. otherwise, any `antipattern` hit: **works, but wrong**;
3. otherwise: **right**.

A run with no results at all is **wrong**. The rule is the pure function `verdict(results)`
exported from `@quest/shared`.

## Templating

Any string in a level, markdown file, fixture or `.redis` solution may use:

| variable | value |
|---|---|
| `{{player.id}}` | the learner's player id |
| `{{player.name}}` | the learner's display name |
| `{{level.id}}` | this level's id |
| `{{chapter.id}}` | this level's chapter id |
| `{{env.NAME}}` | an environment value the engine passes in (`NAME` is upper case) |

Anything else is a validation error. Write `\{{` for a literal `{{`. In YAML, **quote any value
that starts with `{{`** (`"{{player.id}}"`), or YAML reads it as a map. Command names
(`cmd[0]`) cannot be templated.

## Running the validator

```sh
pnpm --filter @quest/shared build
pnpm --filter @quest/shared levels:validate                      # all of levels/
pnpm --filter @quest/shared levels:validate levels/ch1-keyspace  # one chapter
node packages/shared/dist/levels/cli.js levels/_examples/example-cli
```

It prints every problem as `file:line:col field.path: message`, for example:

```
levels/_examples/invalid/two-assertions/01-scoreboard.yaml:17:9 verify[0].checks[0]: exactly one assertion required (found: equals, gte)
```

and exits 1 if there is any. `levels/_examples` as a whole fails on purpose (it contains
`invalid/`); validate the example chapters one by one.
