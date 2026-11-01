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
| `teach` | yes | markdown, or `{ file: ./x.md }` |
| `task` | yes | markdown, or `{ file: ./x.md }` |
| `verify` | yes | non-empty list of verifiers (below) |
| `reward` | yes | `xp` (positive integer), optional `badge` |
| `solutions` | yes | see "Solutions" |
| `setup` | no | list of `{ cmd: [...] }`, `{ sql: "..." }` or `{ script: path }` |
| `scenario` | no | load scenario id for the live pain panel (e.g. `toss-time-100`) |
| `hints` | no | ordered list of strings |
| `show_me` | no | `{ component, keys, title? }`, see below; a bare component id is still accepted |
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

- A `decision` level needs at least one `quiz`; a `code` level needs a `behavior` or `traffic`.
- An `antipattern` verifier needs at least one `works_but_wrong` solution, and a
  `works_but_wrong` solution needs an `antipattern` verifier (each detector is proven to fire).
- `setup` and fixtures may not run `FLUSHALL`, `FLUSHDB` or `SHUTDOWN`, and may not touch any key
  starting with `game:`. That prefix belongs to the engine (the learner's save file).

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
```

`baseline: true` means the check is graded against a baseline: the engine records it itself by
running the same scenario with the level's learner slots deactivated (levels never record one).
The three `*_ratio_*` assertions need `baseline: true`; the absolute ones (`hit_ratio_gte`,
`error_rate_lte`, `db_queries_lte`, `p99_ms_lte`) do not.

### `event`

```yaml
- type: event
  kind: channel_message       # redis_disconnect | redis_reconnect | channel_message | key_expired | service_scaled | custom
  match: { channel: "score:match:42" }
  timeoutMs: 30000
```

`channel_message` needs `match.channel`, `key_expired` needs `match.key`, `service_scaled` needs
`match.service`, `custom` needs `match.name`. Other `match` fields are passed to the engine as is.

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
