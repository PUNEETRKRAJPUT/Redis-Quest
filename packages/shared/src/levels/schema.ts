// The level file contract. Every level in `levels/` is parsed with these schemas, and the
// verifier engine (P0-09) consumes the inferred types. Rules that need the file system
// (ids against file names, referenced files exist, templates) live in loader.ts; rules that
// only need the parsed value live here, so they also hold for levels built in memory (tests).
//
// Field names follow PLAN.md section 4 and the P0-05 spec verbatim, which is why the file mixes
// snake_case (`show_me`, `is_reasonable`, traffic metrics) and camelCase (`timeoutMs`,
// `allowWrite`). Names this task added follow the convention of their neighbours.

import { z } from 'zod';
import { commandKey, isReadOnlyCommand, SETUP_FORBIDDEN_COMMANDS } from './commands.js';

// ---------------------------------------------------------------------------------------------
// Primitives

const KEBAB = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** Non-empty after trimming; the value itself is kept untouched (markdown whitespace matters). */
const text = z.string().refine((s) => s.trim().length > 0, { message: 'must not be empty' });

const kebabId = (what: string) =>
  z.string().regex(KEBAB, `${what} must be kebab-case (lowercase letters, digits, single dashes)`);

export const CHAPTER_ID = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;
export const LEVEL_ID = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*-\d{2}-[a-z0-9]+(?:-[a-z0-9]+)*$/;
/** Level file names: `NN-slug.yaml`. */
export const LEVEL_FILE_NAME = /^(\d{2})-([a-z0-9]+(?:-[a-z0-9]+)*)\.yaml$/;
/** Slot names as declared in the app's slot registry (P0-07), e.g. `cache.getPlayerStats`. */
export const SLOT_NAME = /^[a-z][A-Za-z0-9]*\.[a-z][A-Za-z0-9]*$/;
export const DOCS_URL_PREFIX = 'https://redis.io/docs/';

const levelId = z.string().regex(LEVEL_ID, 'must look like <chapter>-<NN>-<slug>, e.g. ch1-07-hostel-scoreboard');
const chapterId = z.string().regex(CHAPTER_ID, 'must be lowercase letters, digits and dashes, starting with a letter');

/**
 * A path relative to the file it is written in. Existence and "stays inside the levels tree" are
 * checked by the loader; here we only reject shapes that can never be right.
 */
const relPath = z
  .string()
  .min(1, 'must not be empty')
  .refine((p) => !p.startsWith('/') && !/^[A-Za-z]:[\\/]/.test(p), { message: 'must be a relative path' })
  .refine((p) => !p.includes('\\'), { message: 'use forward slashes in paths' });

/**
 * A Redis command as an argv list. YAML numbers are accepted for convenience
 * (`[EXPIRE, otp:1001, 120]`) and normalised to strings, which is what goes on the wire.
 */
const command = z
  .array(z.union([z.string(), z.number()]), { error: 'must be a list like [TYPE, "some:key"]' })
  .min(1, 'must not be empty')
  .transform((argv) => argv.map((a) => String(a)));

/** A reply value to compare against. `null` means a nil reply. Lists compare element-wise. */
export type ReplyValue = string | number | null | ReplyValue[];
const replyValue: z.ZodType<ReplyValue> = z.lazy(() =>
  z.union([z.string(), z.number(), z.null(), z.array(replyValue)], {
    error: 'must be a string, a number, null (nil) or a list of those',
  }),
);

export type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };
const jsonValue = z.json() as z.ZodType<JsonValue>;

function hasLiteralCommandName(argv: readonly string[]): boolean {
  return !(argv[0] ?? '').includes('{{');
}

function present(obj: object, keys: readonly string[]): string[] {
  const rec = obj as Record<string, unknown>;
  return keys.filter((k) => rec[k] !== undefined);
}

// ---------------------------------------------------------------------------------------------
// Redis checks (used by `redis`, `antipattern` and behavior `sideEffect`)

export const ASSERTION_KEYS = [
  'equals',
  'notEquals',
  'gte',
  'lte',
  'between',
  'exists',
  'matches',
  'oneOf',
  'lengthGte',
  'contains',
  'notContains',
] as const;
export type AssertionKey = (typeof ASSERTION_KEYS)[number];

export const redisCheckSchema = z
  .strictObject({
    cmd: command,
    equals: replyValue.optional(),
    notEquals: replyValue.optional(),
    gte: z.number().optional(),
    lte: z.number().optional(),
    between: z.tuple([z.number(), z.number()], { error: 'must be [min, max]' }).optional(),
    exists: z.boolean().optional(),
    matches: z.string().optional(),
    oneOf: z.array(replyValue).min(1, 'must list at least one value').optional(),
    lengthGte: z.number().int().min(0).optional(),
    contains: z.union([z.string(), z.number()]).optional(),
    // E-02: the negation of `contains`: a string reply must not hold this text (a list: no element equals it).
    notContains: z.string().min(1, 'must not be empty (every reply contains the empty string)').optional(),
    message: text.optional(),
    allowWrite: z.literal(true, { error: 'allowWrite can only be true (omit it otherwise)' }).optional(),
    reason: text.optional(),
  })
  .superRefine((c, ctx) => {
    const found = present(c, ASSERTION_KEYS);
    if (found.length !== 1) {
      ctx.addIssue({
        code: 'custom',
        path: [],
        message:
          found.length === 0
            ? `exactly one assertion required (none found; use one of: ${ASSERTION_KEYS.join(', ')})`
            : `exactly one assertion required (found: ${found.join(', ')})`,
      });
    }
    if (c.between && c.between[0] > c.between[1]) {
      ctx.addIssue({ code: 'custom', path: ['between'], message: 'between: [min, max] needs min <= max' });
    }
    if (c.matches !== undefined) {
      try {
        new RegExp(c.matches);
      } catch (e) {
        ctx.addIssue({ code: 'custom', path: ['matches'], message: `not a valid regular expression: ${(e as Error).message}` });
      }
    }
    if (!hasLiteralCommandName(c.cmd)) {
      ctx.addIssue({ code: 'custom', path: ['cmd', 0], message: 'the command name must be literal, not a template' });
      return;
    }
    const readOnly = isReadOnlyCommand(c.cmd);
    if (!readOnly && !c.allowWrite) {
      ctx.addIssue({
        code: 'custom',
        path: ['cmd', 0],
        message: `${commandKey(c.cmd)} is not on the read-only allowlist; verifier checks must not change the learner's data (add allowWrite: true and a reason if this check really must write)`,
      });
    }
    if (c.allowWrite && readOnly) {
      ctx.addIssue({ code: 'custom', path: ['allowWrite'], message: `${commandKey(c.cmd)} is read-only; remove allowWrite` });
    }
    if (c.allowWrite && !c.reason) {
      ctx.addIssue({ code: 'custom', path: ['allowWrite'], message: 'allowWrite: true requires a reason' });
    }
    if (c.reason && !c.allowWrite) {
      ctx.addIssue({ code: 'custom', path: ['reason'], message: 'reason is only used together with allowWrite: true' });
    }
  });

// ---------------------------------------------------------------------------------------------
// Setup steps (level `setup` and behavior fixture files)

const setupStepObject = z
  .strictObject({
    cmd: command.optional(),
    sql: text.optional(),
    script: relPath.optional(),
  })
  .superRefine((s, ctx) => {
    const found = present(s, ['cmd', 'sql', 'script']);
    if (found.length !== 1) {
      ctx.addIssue({
        code: 'custom',
        path: [],
        message: `a setup step is exactly one of cmd, sql or script (found: ${found.length ? found.join(', ') : 'none'})`,
      });
      return;
    }
    if (s.cmd) {
      if (!hasLiteralCommandName(s.cmd)) {
        ctx.addIssue({ code: 'custom', path: ['cmd', 0], message: 'the command name must be literal, not a template' });
      } else if (SETUP_FORBIDDEN_COMMANDS.has(commandKey(s.cmd))) {
        ctx.addIssue({
          code: 'custom',
          path: ['cmd', 0],
          message: `${commandKey(s.cmd)} is not allowed in setup: it would wipe the engine's game:* keys (delete your level's own keys instead)`,
        });
      }
      s.cmd.slice(1).forEach((arg, i) => {
        if (arg.startsWith('game:')) {
          ctx.addIssue({
            code: 'custom',
            path: ['cmd', i + 1],
            message: 'the game:* key prefix belongs to the engine; levels use their own prefixes',
          });
        }
      });
    }
  });

export type SetupStep = { cmd: string[] } | { sql: string } | { script: string };
export const setupStepSchema = setupStepObject.transform((s) => s as SetupStep);

/** Contents of a behavior verifier's `fixtures` file: steps that reset state before each run. */
export const fixtureFileSchema = z.strictObject({
  steps: z.array(setupStepSchema).min(1, 'must list at least one step'),
});

// ---------------------------------------------------------------------------------------------
// Verifiers

const numericAssertion = {
  equals: z.number().optional(),
  gte: z.number().optional(),
  lte: z.number().optional(),
  between: z.tuple([z.number(), z.number()], { error: 'must be [min, max]' }).optional(),
};
const NUMERIC_KEYS = ['equals', 'gte', 'lte', 'between'] as const;

const expectCountSchema = z
  .strictObject({ value: jsonValue, ...numericAssertion })
  .superRefine((c, ctx) => {
    const found = present(c, NUMERIC_KEYS);
    if (found.length !== 1) {
      ctx.addIssue({
        code: 'custom',
        path: [],
        message: `exactly one of ${NUMERIC_KEYS.join(', ')} required (found: ${found.length ? found.join(', ') : 'none'})`,
      });
    }
    if (c.between && c.between[0] > c.between[1]) {
      ctx.addIssue({ code: 'custom', path: ['between'], message: 'between: [min, max] needs min <= max' });
    }
  });

export const behaviorAssertionSchema = z
  .strictObject({
    call: z.strictObject({ args: z.array(jsonValue).default([]) }),
    repeat: z.number().int().min(1).max(10000).optional(),
    expect: jsonValue.optional(),
    expectError: z.union([z.literal(true), z.string()], { error: 'must be true or a regular expression' }).optional(),
    expectCount: expectCountSchema.optional(),
    sideEffect: z.array(redisCheckSchema).min(1, 'must list at least one check').optional(),
    message: text.optional(),
  })
  .superRefine((a, ctx) => {
    const outcome = present(a, ['expect', 'expectError', 'expectCount']);
    if (outcome.length > 1) {
      ctx.addIssue({ code: 'custom', path: [], message: `use only one of expect, expectError, expectCount (found: ${outcome.join(', ')})` });
    }
    if (outcome.length === 0 && !a.sideEffect) {
      ctx.addIssue({ code: 'custom', path: [], message: 'an assertion needs expect, expectError, expectCount or sideEffect' });
    }
    if (a.expectCount && (a.repeat ?? 1) < 2) {
      ctx.addIssue({ code: 'custom', path: ['expectCount'], message: 'expectCount counts over repeated calls; set repeat to 2 or more' });
    }
    if (typeof a.expectError === 'string') {
      try {
        new RegExp(a.expectError);
      } catch (e) {
        ctx.addIssue({ code: 'custom', path: ['expectError'], message: `not a valid regular expression: ${(e as Error).message}` });
      }
    }
  });

const redisVerifier = z.strictObject({
  type: z.literal('redis'),
  checks: z.array(redisCheckSchema).min(1, 'must list at least one check'),
});

const slotName = z.string().regex(SLOT_NAME, 'must be a slot name like cache.getPlayerStats');
const concurrency = z.number().int().min(1).max(1000);
const ANTIPATTERN_BEHAVIOR_KEYS = ['slot', 'fixtures', 'assertions', 'concurrency'] as const;

/**
 * An antipattern verifier comes in two shapes, exactly one per entry:
 * - `checks`: redis checks describing the healthy state (e.g. no list copy of a leaderboard);
 * - `slot` + `fixtures` + `assertions` (+ `concurrency`): a behavior run describing healthy behavior
 *   (e.g. at most 10 of 100 concurrent requests allowed), for antipatterns only visible in code,
 *   such as a non-atomic read-then-write that races under load.
 * Either way a failing check or assertion is the hit, and each needs a message.
 */
export type AntipatternVerifier =
  | { type: 'antipattern'; checks: RedisCheck[] }
  | { type: 'antipattern'; slot: string; fixtures: string; concurrency?: number; assertions: BehaviorAssertion[] };

const antipatternVerifier = z
  .strictObject({
    type: z.literal('antipattern'),
    checks: z.array(redisCheckSchema).min(1, 'must list at least one check').optional(),
    slot: slotName.optional(),
    fixtures: relPath.optional(),
    concurrency: concurrency.optional(),
    assertions: z.array(behaviorAssertionSchema).min(1, 'must list at least one assertion').optional(),
  })
  .superRefine((v, ctx) => {
    const behaviorKeys = present(v, ANTIPATTERN_BEHAVIOR_KEYS);
    if (v.checks && behaviorKeys.length) {
      ctx.addIssue({
        code: 'custom',
        path: [],
        message: `an antipattern uses either checks or slot/fixtures/assertions, not both (found checks and ${behaviorKeys.join(', ')})`,
      });
      return;
    }
    if (!v.checks) {
      const missing = present({ slot: 1, fixtures: 1, assertions: 1 }, ['slot', 'fixtures', 'assertions']).filter(
        (k) => !behaviorKeys.includes(k as (typeof ANTIPATTERN_BEHAVIOR_KEYS)[number]),
      );
      if (missing.length) {
        ctx.addIssue({
          code: 'custom',
          path: [],
          message: behaviorKeys.length
            ? `a behavior-shaped antipattern needs slot, fixtures and assertions (missing: ${missing.join(', ')})`
            : 'an antipattern needs checks, or slot + fixtures + assertions',
        });
        return;
      }
    }
    // The "works, but wrong" message is the most valuable feedback in the game; never let
    // the engine fall back to a generic sentence for it.
    v.checks?.forEach((c, i) => {
      if (!c.message) {
        ctx.addIssue({ code: 'custom', path: ['checks', i], message: 'antipattern checks need a message (it is the "works, but wrong" feedback)' });
      }
    });
    v.assertions?.forEach((a, i) => {
      if (!a.message) {
        ctx.addIssue({ code: 'custom', path: ['assertions', i], message: 'antipattern assertions need a message (it is the "works, but wrong" feedback)' });
      }
    });
  })
  .transform((v) => v as AntipatternVerifier);

const behaviorVerifier = z.strictObject({
  type: z.literal('behavior'),
  slot: slotName,
  fixtures: relPath,
  concurrency: concurrency.optional(),
  assertions: z.array(behaviorAssertionSchema).min(1, 'must list at least one assertion'),
  message: text.optional(),
});

export const TRAFFIC_ASSERTION_KEYS = [
  'p99_ratio_lte',
  'rps_ratio_gte',
  'db_calls_ratio_lte',
  'redis_calls_ratio_lte',
  'hit_ratio_gte',
  'error_rate_lte',
  'db_queries_lte',
  'p99_ms_lte',
  'redis_per_request_lte',
] as const;
const BASELINE_RATIO_KEYS = ['p99_ratio_lte', 'rps_ratio_gte', 'db_calls_ratio_lte', 'redis_calls_ratio_lte'] as const;

const trafficVerifier = z
  .strictObject({
    type: z.literal('traffic'),
    scenario: kebabId('scenario'),
    baseline: z.boolean(),
    assertions: z.strictObject({
      p99_ratio_lte: z.number().positive().optional(),
      rps_ratio_gte: z.number().positive().optional(),
      db_calls_ratio_lte: z.number().min(0).optional(),
      // E-02: Redis commands per app request, relative to the baseline's.
      redis_calls_ratio_lte: z.number().min(0).optional(),
      hit_ratio_gte: z.number().min(0).max(1).optional(),
      error_rate_lte: z.number().min(0).max(1).optional(),
      // Absolute: total Postgres queries during the run, and p99 latency in milliseconds.
      db_queries_lte: z.number().int().min(0).optional(),
      p99_ms_lte: z.number().positive().optional(),
      // E-02: absolute Redis commands per app request (the app's own count, summed over the run window).
      redis_per_request_lte: z.number().min(0).optional(),
    }),
    message: text.optional(),
  })
  .superRefine((v, ctx) => {
    const found = present(v.assertions, TRAFFIC_ASSERTION_KEYS);
    if (found.length === 0) {
      ctx.addIssue({ code: 'custom', path: ['assertions'], message: `at least one of ${TRAFFIC_ASSERTION_KEYS.join(', ')} required` });
    }
    if (!v.baseline) {
      for (const k of present(v.assertions, BASELINE_RATIO_KEYS)) {
        ctx.addIssue({ code: 'custom', path: ['assertions', k], message: `${k} is relative to the baseline run; set baseline: true` });
      }
    }
  });

export const EVENT_KINDS = [
  'redis_disconnect',
  'redis_reconnect',
  'channel_message',
  'key_expired',
  'service_scaled',
  'custom',
] as const;
/** The `match` key each event kind needs; kinds not listed take an optional, free-form match. */
const EVENT_REQUIRED_MATCH: Partial<Record<(typeof EVENT_KINDS)[number], string>> = {
  channel_message: 'channel',
  key_expired: 'key',
  service_scaled: 'service',
  custom: 'name',
};

const eventVerifier = z
  .strictObject({
    type: z.literal('event'),
    kind: z.enum(EVENT_KINDS),
    match: z.record(z.string(), jsonValue).optional(),
    timeoutMs: z.number().int().min(100).max(600000),
    message: text.optional(),
  })
  .superRefine((v, ctx) => {
    const key = EVENT_REQUIRED_MATCH[v.kind];
    if (key && typeof v.match?.[key] !== 'string') {
      ctx.addIssue({ code: 'custom', path: v.match ? ['match'] : [], message: `event kind ${v.kind} needs match.${key} (a string)` });
    }
  });

const quizOption = z.strictObject({ id: kebabId('option id'), label: text });

const quizVerifier = z
  .strictObject({
    type: z.literal('quiz'),
    question: text,
    options: z.array(quizOption).min(2, 'a quiz needs at least two options'),
    correct: z.union([kebabId('option id'), z.array(kebabId('option id')).min(1)], {
      error: 'must be an option id or a list of option ids',
    }),
    explanation: text,
  })
  .superRefine((q, ctx) => {
    const ids = new Set<string>();
    q.options.forEach((o, i) => {
      if (ids.has(o.id)) ctx.addIssue({ code: 'custom', path: ['options', i, 'id'], message: `duplicate option id ${o.id}` });
      ids.add(o.id);
    });
    const correct = typeof q.correct === 'string' ? [q.correct] : q.correct;
    correct.forEach((c, i) => {
      if (!ids.has(c)) {
        ctx.addIssue({
          code: 'custom',
          path: typeof q.correct === 'string' ? ['correct'] : ['correct', i],
          message: `${c} is not one of this quiz's option ids`,
        });
      }
    });
  })
  // Normalised so consumers never branch on string vs list.
  .transform((q) => ({ ...q, correct: typeof q.correct === 'string' ? [q.correct] : q.correct }));

/**
 * A typed answer whose expected value is read from Redis at verification time (e.g. "type back the
 * value of one field", "how many users did SCAN find", "the TTL you saw"). The engine runs
 * `expected.cmd` (read-only, templated like any check), applies `transform`, and compares it with the
 * learner's trimmed text: `equals` as strings (numbers when transform is number or length),
 * `numeric_within` as |answer - expected| <= tolerance.
 */
const answerVerifier = z
  .strictObject({
    type: z.literal('answer'),
    prompt: text,
    expected: z.strictObject({
      cmd: command,
      transform: z.enum(['string', 'number', 'length']).optional(),
    }),
    compare: z.enum(['equals', 'numeric_within']).optional(),
    tolerance: z.number().min(0).optional(),
    message: text,
  })
  .superRefine((a, ctx) => {
    if (!hasLiteralCommandName(a.expected.cmd)) {
      ctx.addIssue({ code: 'custom', path: ['expected', 'cmd', 0], message: 'the command name must be literal, not a template' });
    } else if (!isReadOnlyCommand(a.expected.cmd)) {
      ctx.addIssue({
        code: 'custom',
        path: ['expected', 'cmd', 0],
        message: `${commandKey(a.expected.cmd)} is not on the read-only allowlist; an answer's expected value must be read without changing the learner's data`,
      });
    }
    if (a.compare === 'numeric_within' && a.tolerance === undefined) {
      ctx.addIssue({ code: 'custom', path: ['compare'], message: 'numeric_within needs a tolerance' });
    }
    if (a.tolerance !== undefined && a.compare !== 'numeric_within') {
      ctx.addIssue({ code: 'custom', path: ['tolerance'], message: 'tolerance is only used with compare: numeric_within' });
    }
    if (a.compare === 'numeric_within' && a.expected.transform === 'string') {
      ctx.addIssue({ code: 'custom', path: ['expected', 'transform'], message: 'numeric_within compares numbers; use transform number or length' });
    }
  });

export const VERIFY_TYPES = ['redis', 'antipattern', 'behavior', 'traffic', 'event', 'quiz', 'answer'] as const;
export type VerifyType = (typeof VERIFY_TYPES)[number];

export const verifySpecSchema = z.discriminatedUnion('type', [
  redisVerifier,
  antipatternVerifier,
  behaviorVerifier,
  trafficVerifier,
  eventVerifier,
  quizVerifier,
  answerVerifier,
]);

// ---------------------------------------------------------------------------------------------
// Level

export const LEVEL_MODES = ['cli', 'code', 'ops', 'decision'] as const;
export type LevelMode = (typeof LEVEL_MODES)[number];

/** The brainstorm list must always offer this option (PLAN.md 4b, beat 3). */
export const NOT_REDIS_OPTION_ID = 'not-redis';

const brainstormSchema = z
  .strictObject({
    prompt: text,
    options: z
      .array(z.strictObject({ id: kebabId('option id'), label: text, is_reasonable: z.boolean() }))
      .min(2, 'a brainstorm needs at least two options'),
  })
  .superRefine((b, ctx) => {
    const ids = new Set<string>();
    b.options.forEach((o, i) => {
      if (ids.has(o.id)) ctx.addIssue({ code: 'custom', path: ['options', i, 'id'], message: `duplicate option id ${o.id}` });
      ids.add(o.id);
    });
    if (!ids.has(NOT_REDIS_OPTION_ID)) {
      ctx.addIssue({ code: 'custom', path: ['options'], message: `the options must include id: ${NOT_REDIS_OPTION_ID}` });
    }
    if (!b.options.some((o) => o.is_reasonable)) {
      ctx.addIssue({ code: 'custom', path: ['options'], message: 'at least one option must have is_reasonable: true' });
    }
  });

/** File extensions a reference or wrong solution may have, per mode. */
export const SOLUTION_EXTENSIONS: Record<Exclude<LevelMode, 'decision'>, readonly string[]> = {
  cli: ['.redis'],
  ops: ['.sh', '.redis'],
  code: ['.js', '.mjs'],
};

const fileSolutions = z.strictObject({
  reference: relPath,
  wrong: z
    .array(
      z.strictObject({
        path: relPath,
        expect: z.enum(['wrong', 'works_but_wrong']),
        because: text,
      }),
    )
    .min(1, 'every level ships at least one known-wrong solution'),
});

const decisionSolutions = z.strictObject({
  reference: z
    .union([kebabId('option id'), z.array(kebabId('option id')).min(1)], { error: 'must be an option id or a list of option ids' })
    .transform((r) => (typeof r === 'string' ? [r] : r)),
  wrong: z
    .array(
      z.strictObject({
        option: kebabId('option id'),
        expect: z.literal('wrong', { error: 'a wrong option in a decision level can only be expect: wrong' }),
        because: text,
      }),
    )
    .min(1, 'every level ships at least one known-wrong solution'),
});

const showMeComponent = z.string().regex(/^[a-z][a-z0-9_]*$/, 'must be a UI component id like leaderboard_panel');

/**
 * `show_me` is either a bare component id (kept for compatibility) or `{ component, keys, title? }`.
 * Keys are templated like any other level text (`{{player.id}}`). Both forms normalise to the object,
 * with `keys: []` for the string form, so everything downstream sees one shape.
 */
export interface ShowMe {
  component: string;
  keys: string[];
  title?: string;
}
const showMeSchema = z
  .union([
    showMeComponent,
    z.strictObject({
      component: showMeComponent,
      keys: z.array(text).default([]),
      title: text.optional(),
    }),
  ])
  .transform((v): ShowMe => (typeof v === 'string' ? { component: v, keys: [] } : v));

/**
 * F-12. A timed blank rebuild: the level is graded like any other, but there is no teaching, a countdown
 * runs, hints cost XP, and the elapsed time is recorded. `rebuild_of` must name a level in the same chapter
 * (earlier) or an earlier chapter; that needs the whole tree, so the loader checks it, not this schema.
 */
export const INTERVIEW_MINUTES_MIN = 5;
export const INTERVIEW_MINUTES_MAX = 60;
export const INTERVIEW_DEFAULT_HINT_XP_COST = 10;
export const interviewSchema = z.strictObject({
  minutes: z
    .number({ error: 'must be a whole number of minutes' })
    .int('must be a whole number of minutes')
    .min(INTERVIEW_MINUTES_MIN, `must be at least ${INTERVIEW_MINUTES_MIN} minutes`)
    .max(INTERVIEW_MINUTES_MAX, `must be at most ${INTERVIEW_MINUTES_MAX} minutes`),
  rebuild_of: levelId,
  hint_xp_cost: z
    .number({ error: 'must be a whole number of XP' })
    .int('must be a whole number of XP')
    .min(0, 'must not be negative')
    .max(1000, 'must be at most 1000')
    .default(INTERVIEW_DEFAULT_HINT_XP_COST),
});
export type Interview = z.output<typeof interviewSchema>;

const levelBase = {
  id: levelId,
  chapter: chapterId,
  title: text,
  story: text,
  brainstorm: brainstormSchema,
  teach: text,
  task: text,
  setup: z.array(setupStepSchema).min(1, 'omit setup instead of leaving it empty').optional(),
  scenario: kebabId('scenario').optional(),
  hints: z.array(text).min(1, 'omit hints instead of leaving it empty').optional(),
  verify: z.array(verifySpecSchema).min(1, 'a level needs at least one verifier'),
  show_me: showMeSchema.optional(),
  docs: z
    .array(
      z.string().refine((u) => u.startsWith(DOCS_URL_PREFIX) && !/\s/.test(u), {
        message: `docs links must be official pages starting with ${DOCS_URL_PREFIX}`,
      }),
    )
    .min(1, 'omit docs instead of leaving it empty')
    .optional(),
  min_redis_version: z
    .string({ error: 'must be a quoted version string like "8.4"' })
    .regex(/^\d+\.\d+(?:\.\d+)?$/, 'must be a version like "8.4" or "8.4.0"')
    .optional(),
  reward: z.strictObject({ xp: z.number().int().positive(), badge: text.optional() }),
};

const fileModeLevel = <M extends Exclude<LevelMode, 'decision' | 'code'>>(mode: M) =>
  z.strictObject({ ...levelBase, mode: z.literal(mode), solutions: fileSolutions });

// Only a code level can be an interview rebuild, and only then may `teach` be left out.
const codeLevel = z.strictObject({
  ...levelBase,
  teach: text.optional(),
  interview: interviewSchema.optional(),
  mode: z.literal('code'),
  solutions: fileSolutions,
});

const levelUnion = z.discriminatedUnion('mode', [
  fileModeLevel('cli'),
  codeLevel,
  fileModeLevel('ops'),
  z.strictObject({ ...levelBase, mode: z.literal('decision'), solutions: decisionSolutions }),
]);

type LevelUnion = z.output<typeof levelUnion>;

function checkLevel(level: LevelUnion, ctx: z.RefinementCtx): void {
  const types = level.verify.map((v) => v.type);

  if (level.mode === 'code' && level.teach === undefined && level.interview === undefined) {
    ctx.addIssue({ code: 'custom', path: ['teach'], message: 'required (it may only be left out on an interview level)' });
  }

  // Decision solutions name quiz option ids, so a decision level needs a quiz; `answer`
  // verifiers belong in cli and ops levels (typed values read back from Redis).
  if (level.mode === 'decision' && !types.includes('quiz')) {
    ctx.addIssue({ code: 'custom', path: ['verify'], message: 'a decision level needs at least one quiz verifier' });
  }
  if (level.mode === 'code' && !types.includes('behavior') && !types.includes('traffic')) {
    ctx.addIssue({ code: 'custom', path: ['verify'], message: 'a code level needs at least one behavior or traffic verifier' });
  }

  if (level.mode === 'decision') {
    // Option ids are unique across all quizzes so `solutions` can name them unambiguously.
    const seen = new Map<string, boolean>(); // option id -> is correct
    level.verify.forEach((v, vi) => {
      if (v.type !== 'quiz') return;
      v.options.forEach((o, oi) => {
        if (seen.has(o.id)) {
          ctx.addIssue({ code: 'custom', path: ['verify', vi, 'options', oi, 'id'], message: `option id ${o.id} is used by another quiz in this level` });
        }
        seen.set(o.id, v.correct.includes(o.id));
      });
    });
    const correct = [...seen].filter(([, ok]) => ok).map(([id]) => id);
    const reference = level.solutions.reference;
    reference.forEach((id, i) => {
      if (seen.get(id) !== true) {
        ctx.addIssue({ code: 'custom', path: ['solutions', 'reference', i], message: `${id} is not a correct option of any quiz in this level` });
      }
    });
    const missing = correct.filter((id) => !reference.includes(id));
    if (missing.length) {
      ctx.addIssue({ code: 'custom', path: ['solutions', 'reference'], message: `the reference must list every correct option (missing: ${missing.join(', ')})` });
    }
    level.solutions.wrong.forEach((w, i) => {
      if (!seen.has(w.option)) {
        ctx.addIssue({ code: 'custom', path: ['solutions', 'wrong', i, 'option'], message: `${w.option} is not an option of any quiz in this level` });
      } else if (seen.get(w.option)) {
        ctx.addIssue({ code: 'custom', path: ['solutions', 'wrong', i, 'option'], message: `${w.option} is a correct answer, not a wrong one` });
      }
    });
    return;
  }

  const exts = SOLUTION_EXTENSIONS[level.mode];
  const checkExt = (p: string, path: (string | number)[]) => {
    if (!exts.some((e) => p.endsWith(e))) {
      ctx.addIssue({ code: 'custom', path, message: `a ${level.mode} solution must be a ${exts.join(' or ')} file` });
    }
  };
  checkExt(level.solutions.reference, ['solutions', 'reference']);
  level.solutions.wrong.forEach((w, i) => checkExt(w.path, ['solutions', 'wrong', i, 'path']));

  // Every antipattern detector is proven against a known antipattern implementation, and a
  // "works, but wrong" solution is only possible if there is a detector to fire.
  const antipatternIndex = types.indexOf('antipattern');
  const wbw = level.solutions.wrong.findIndex((w) => w.expect === 'works_but_wrong');
  if (antipatternIndex !== -1 && wbw === -1) {
    ctx.addIssue({
      code: 'custom',
      path: ['verify', antipatternIndex],
      message: 'an antipattern verifier needs at least one solutions.wrong entry with expect: works_but_wrong',
    });
  }
  if (antipatternIndex === -1 && wbw !== -1) {
    ctx.addIssue({
      code: 'custom',
      path: ['solutions', 'wrong', wbw, 'expect'],
      message: 'works_but_wrong needs an antipattern verifier in verify',
    });
  }
}

export const levelFileSchema = levelUnion.superRefine(checkLevel);

// ---------------------------------------------------------------------------------------------
// Chapter

export const chapterSchema = z
  .strictObject({
    id: chapterId,
    title: text,
    incident: z
      .array(
        z.strictObject({
          from: z.string().regex(/^[a-z][a-z0-9-]*$/, 'must be a cast slug like roommate or you'),
          time: z.string({ error: 'must be a quoted 24-hour time like "19:31"' }).regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'must be a 24-hour time like "19:31"'),
          text: text,
        }),
      )
      .min(1, 'the incident thread needs at least one message'),
    levels: z.array(levelId).min(1, 'a chapter lists at least one level'),
  })
  .superRefine((c, ctx) => {
    const seen = new Set<string>();
    c.levels.forEach((id, i) => {
      if (seen.has(id)) ctx.addIssue({ code: 'custom', path: ['levels', i], message: `${id} is listed twice` });
      seen.add(id);
    });
  });

// ---------------------------------------------------------------------------------------------
// Inferred types (the contract P0-06, P0-09 and P0-10 import)

/** A parsed, validated level. Markdown fields are inlined strings; paths are still relative to the level file. */
export type LevelFile = z.output<typeof levelFileSchema>;
export type Chapter = z.output<typeof chapterSchema>;
export type VerifySpec = z.output<typeof verifySpecSchema>;
export type RedisCheck = z.output<typeof redisCheckSchema>;
export type BehaviorAssertion = z.output<typeof behaviorAssertionSchema>;
export type FixtureFile = z.output<typeof fixtureFileSchema>;
export type RedisVerifier = Extract<VerifySpec, { type: 'redis' }>;
export type BehaviorVerifier = Extract<VerifySpec, { type: 'behavior' }>;
export type TrafficVerifier = Extract<VerifySpec, { type: 'traffic' }>;
export type EventVerifier = Extract<VerifySpec, { type: 'event' }>;
export type QuizVerifier = Extract<VerifySpec, { type: 'quiz' }>;
export type AnswerVerifier = Extract<VerifySpec, { type: 'answer' }>;
export type EventKind = (typeof EVENT_KINDS)[number];
