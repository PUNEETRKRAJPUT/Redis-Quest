// D-05. The level studio's draft: what a person fills in on /studio, as plain JSON, and the files it compiles to.
// Nothing here touches the disk or Redis. The engine writes the compiled files to a scratch directory and loads them
// with the real loader (so every error is the validator's own, positioned in the YAML shown in the preview), then
// play-tests the loaded level. The same compile feeds "Get the files".

import { Document, isScalar, isSeq, visit } from 'yaml';
import { z } from 'zod';
import { splitArgsLine } from './redis-script.js';

export const DRAFT_MODES = ['cli', 'decision'] as const;
export type DraftMode = (typeof DRAFT_MODES)[number];

/** Check kinds the studio offers: each has a small form. `custom` is any read-only command plus one comparison. */
export const DRAFT_CHECK_KINDS = [
  'type_is',
  'exists',
  'not_exists',
  'string_equals',
  'number_gte',
  'size_gte',
  'ttl_between',
  'hash_field_equals',
  'zscore_equals',
  'set_has',
  'custom',
] as const;
export type DraftCheckKind = (typeof DRAFT_CHECK_KINDS)[number];

/** The size command per structure, for `size_gte`. */
export const SIZE_COMMANDS: Record<string, string> = {
  list: 'LLEN',
  set: 'SCARD',
  zset: 'ZCARD',
  hash: 'HLEN',
  stream: 'XLEN',
  string: 'STRLEN',
};

export const CUSTOM_COMPARATORS = ['equals', 'notEquals', 'gte', 'lte', 'contains', 'notContains'] as const;

const str = z.string().default('');
const strOrNum = z.union([z.string(), z.number()]).default('');

const checkSchema = z.object({
  kind: z.string(),
  key: str,
  field: str,
  member: str,
  structure: str,
  value: strOrNum,
  min: strOrNum,
  max: strOrNum,
  command: str,
  comparator: str,
  /** Goes into an `antipattern` verifier: it describes the healthy state and a failure is the "works, but wrong" hit. */
  antipattern: z.boolean().default(false),
  message: str,
});
export type DraftCheck = z.input<typeof checkSchema>;

const quizOptionSchema = z.object({ label: str, correct: z.boolean().default(false), because: str });
const quizSchema = z.object({ question: str, options: z.array(quizOptionSchema).default([]), explanation: str });

export const studioDraftSchema = z.object({
  mode: z.enum(DRAFT_MODES),
  pack: str,
  number: z.number().int().default(1),
  slug: str,
  title: str,
  chapterTitle: str,
  incident: z.array(z.object({ from: str, time: str, text: str })).default([]),
  story: str,
  brainstormPrompt: str,
  brainstormOptions: z.array(z.object({ label: str, reasonable: z.boolean().default(false) })).default([]),
  teach: str,
  task: str,
  /** One Redis command per line, run before the level starts (cli). */
  setup: str,
  hints: z.array(str).default([]),
  checks: z.array(checkSchema).default([]),
  quizzes: z.array(quizSchema).default([]),
  /** cli: the reference solution, one command per line. */
  reference: str,
  /** cli: known-wrong solutions; `works_but_wrong` ones need an antipattern check. */
  wrong: z
    .array(z.object({ script: str, expect: z.enum(['wrong', 'works_but_wrong']).default('wrong'), because: str }))
    .default([]),
  author: z.object({ name: str, github: str }).default({ name: '', github: '' }),
});
export type StudioDraft = z.input<typeof studioDraftSchema>;
type Draft = z.output<typeof studioDraftSchema>;

export interface DraftFile {
  /** Relative to the repository root, e.g. `levels/community/house/01-hostel-scoreboard.yaml`. */
  path: string;
  content: string;
}

export interface DraftProblem {
  /** A path into the draft (`checks[1].key`) or `(root)`. */
  path: string;
  message: string;
}

export interface CompiledDraft {
  /** `<pack>-<NN>-<slug>`, when the pieces are present. */
  id?: string;
  pack?: string;
  files: DraftFile[];
  /** Where the files live in the repository: `levels/community/<pack>`. */
  directory?: string;
  problems: DraftProblem[];
}

export const COMMUNITY_DIR = 'levels/community';
const NN = (n: number) => String(n).padStart(2, '0');
const slugOk = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** A YAML number for plain integers, so `[ZADD, key, 150, member]` reads like the campaign's files. */
function arg(a: string): string | number {
  return /^(0|-?[1-9]\d{0,14})$/.test(a) ? Number(a) : a;
}

function argvOf(line: string): (string | number)[] {
  return (splitArgsLine(line) ?? [line]).map(arg);
}

function asText(v: string | number): string {
  return String(v).trim();
}

function num(v: string | number): number | undefined {
  const t = asText(v);
  if (t === '') return undefined;
  const n = Number(t);
  return Number.isFinite(n) ? n : undefined;
}

type Obj = Record<string, unknown>;

/** One check as a level `redis` check, or a problem. */
function compileCheck(c: z.output<typeof checkSchema>, at: string): { check?: Obj; problem?: DraftProblem } {
  const bad = (field: string, message: string) => ({ problem: { path: `${at}.${field}`, message } });
  const key = c.key.trim();
  const needKey = () => (key === '' ? bad('key', 'name the key this check reads') : null);
  const withMessage = (o: Obj): { check: Obj } => ({ check: c.message.trim() ? { ...o, message: c.message } : o });
  const k = c.kind as DraftCheckKind;
  switch (k) {
    case 'type_is': {
      const e = needKey();
      if (e) return e;
      if (asText(c.value) === '') return bad('value', 'give the type, for example zset or hash');
      return withMessage({ cmd: ['TYPE', key], equals: asText(c.value) });
    }
    case 'exists':
    case 'not_exists': {
      const e = needKey();
      if (e) return e;
      return withMessage({ cmd: ['EXISTS', key], equals: k === 'exists' ? 1 : 0 });
    }
    case 'string_equals': {
      const e = needKey();
      if (e) return e;
      return withMessage({ cmd: ['GET', key], equals: String(c.value) });
    }
    case 'number_gte': {
      const e = needKey();
      if (e) return e;
      const n = num(c.value);
      return n === undefined ? bad('value', 'give a number') : withMessage({ cmd: ['GET', key], gte: n });
    }
    case 'size_gte': {
      const e = needKey();
      if (e) return e;
      const cmd = SIZE_COMMANDS[c.structure.trim()];
      if (!cmd) return bad('structure', `pick one of: ${Object.keys(SIZE_COMMANDS).join(', ')}`);
      const n = num(c.value);
      return n === undefined ? bad('value', 'give a number') : withMessage({ cmd: [cmd, key], gte: n });
    }
    case 'ttl_between': {
      const e = needKey();
      if (e) return e;
      const lo = num(c.min);
      const hi = num(c.max);
      if (lo === undefined || hi === undefined) return bad('min', 'give a minimum and a maximum number of seconds');
      return withMessage({ cmd: ['TTL', key], between: [lo, hi] });
    }
    case 'hash_field_equals': {
      const e = needKey();
      if (e) return e;
      if (c.field.trim() === '') return bad('field', 'name the hash field');
      return withMessage({ cmd: ['HGET', key, c.field.trim()], equals: String(c.value) });
    }
    case 'zscore_equals': {
      const e = needKey();
      if (e) return e;
      if (c.member.trim() === '') return bad('member', 'name the member');
      const n = num(c.value);
      return n === undefined ? bad('value', 'give a number') : withMessage({ cmd: ['ZSCORE', key, c.member.trim()], equals: n });
    }
    case 'set_has': {
      const e = needKey();
      if (e) return e;
      if (c.member.trim() === '') return bad('member', 'name the member');
      return withMessage({ cmd: ['SISMEMBER', key, c.member.trim()], equals: 1 });
    }
    case 'custom': {
      if (c.command.trim() === '') return bad('command', 'write the read-only command, for example HGET user:1 name');
      const cmp = c.comparator.trim() || 'equals';
      if (!(CUSTOM_COMPARATORS as readonly string[]).includes(cmp)) {
        return bad('comparator', `pick one of: ${CUSTOM_COMPARATORS.join(', ')}`);
      }
      const numeric = cmp === 'gte' || cmp === 'lte';
      const n = num(c.value);
      if (numeric && n === undefined) return bad('value', 'give a number');
      const value = numeric ? n : cmp === 'equals' || cmp === 'notEquals' ? String(c.value) : asText(c.value);
      return withMessage({ cmd: argvOf(c.command), [cmp]: value });
    }
    default:
      return bad('kind', `unknown check kind ${JSON.stringify(c.kind)} (use one of: ${DRAFT_CHECK_KINDS.join(', ')})`);
  }
}

function brainstormOf(d: Draft): Obj {
  const options: Obj[] = d.brainstormOptions
    .filter((o) => o.label.trim() !== '')
    .map((o, i) => ({ id: `idea-${String.fromCharCode(97 + i)}`, label: o.label, is_reasonable: o.reasonable }));
  options.push({ id: 'not-redis', label: 'Not Redis: this does not need a cache or a store at all', is_reasonable: false });
  // The schema wants one reasonable option; a draft that has none yet is reported by the validator on this path.
  return { prompt: d.brainstormPrompt, options };
}

const OPTION_LETTERS = 'abcdefghijklmnopqrstuvwxyz';

/** Decision levels: the quizzes with generated option ids (`q1-a`), the reference and the known-wrong options. */
function compileQuizzes(d: Draft): { verify: Obj[]; reference: string[]; wrong: Obj[] } {
  const verify: Obj[] = [];
  const reference: string[] = [];
  const wrong: Obj[] = [];
  d.quizzes.forEach((q, qi) => {
    const options = q.options.map((o, oi) => ({ ...o, id: `q${qi + 1}-${OPTION_LETTERS[oi] ?? String(oi)}` }));
    const correct = options.filter((o) => o.correct).map((o) => o.id);
    reference.push(...correct);
    for (const o of options) {
      if (!o.correct) wrong.push({ option: o.id, expect: 'wrong', because: o.because.trim() || q.explanation });
    }
    verify.push({
      type: 'quiz',
      question: q.question,
      options: options.map((o) => ({ id: o.id, label: o.label })),
      correct: correct.length === 1 ? (correct[0] as string) : correct,
      explanation: q.explanation,
    });
  });
  return { verify, reference, wrong };
}

function toYaml(obj: unknown): string {
  const doc = new Document(obj);
  // Commands and the reference list read best on one line, like the campaign's files.
  visit(doc, {
    Pair(_k, pair) {
      if (isScalar(pair.key) && (pair.key.value === 'cmd' || pair.key.value === 'reference') && isSeq(pair.value)) {
        pair.value.flow = true;
      }
    },
  });
  return doc.toString({ lineWidth: 0 });
}

function lineList(text: string): string[] {
  return text
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l !== '' && !l.startsWith('#'));
}

/** Compiles a draft into the files of one community level (plus its chapter.yaml). Problems are about the draft's shape. */
export function compileDraft(input: unknown): CompiledDraft {
  const parsed = studioDraftSchema.safeParse(input);
  if (!parsed.success) {
    return {
      files: [],
      problems: parsed.error.issues.map((i) => ({
        path: i.path.map((p, n) => (typeof p === 'number' ? `[${p}]` : n === 0 ? String(p) : `.${String(p)}`)).join('') || '(root)',
        message: i.message,
      })),
    };
  }
  const d = parsed.data;
  const problems: DraftProblem[] = [];
  const pack = d.pack.trim();
  const slug = d.slug.trim();
  if (!slugOk.test(pack)) problems.push({ path: 'pack', message: 'the pack name is kebab-case: lowercase letters, digits, single dashes' });
  if (!slugOk.test(slug)) problems.push({ path: 'slug', message: 'the level slug is kebab-case, for example hostel-scoreboard' });
  if (!Number.isInteger(d.number) || d.number < 1 || d.number > 99) problems.push({ path: 'number', message: 'the level number is 1 to 99' });
  if (problems.length) return { files: [], problems };

  const stem = `${NN(d.number)}-${slug}`;
  const id = `${pack}-${stem}`;
  const dirRel = `${COMMUNITY_DIR}/${pack}`;
  const author: Obj = { name: d.author.name };
  if (d.author.github.trim()) author.github = d.author.github.trim().replace(/^@/, '');

  const level: Obj = {
    id,
    chapter: pack,
    title: d.title,
    mode: d.mode,
    author,
    story: d.story,
    brainstorm: brainstormOf(d),
    teach: d.teach,
    task: d.task,
  };
  const files: DraftFile[] = [];

  const setupLines = lineList(d.setup);
  if (d.mode === 'cli' && setupLines.length) level.setup = setupLines.map((l) => ({ cmd: argvOf(l) }));
  const hints = d.hints.filter((h) => h.trim() !== '');
  if (hints.length) level.hints = hints;

  if (d.mode === 'cli') {
    const redis: Obj[] = [];
    const anti: Obj[] = [];
    d.checks.forEach((c, i) => {
      const r = compileCheck(c, `checks[${i}]`);
      if (r.problem) problems.push(r.problem);
      else if (r.check) (c.antipattern ? anti : redis).push(r.check);
    });
    const verify: Obj[] = [];
    if (redis.length) verify.push({ type: 'redis', checks: redis });
    if (anti.length) verify.push({ type: 'antipattern', checks: anti });
    level.verify = verify; // empty is reported by the validator ("a level needs at least one verifier")
    level.reward = { xp: 10 };
    const refPath = `solutions/${NN(d.number)}-reference.redis`;
    const wrongEntries: Obj[] = [];
    files.push({ path: `${dirRel}/${refPath}`, content: ensureNewline(d.reference) });
    d.wrong.forEach((w, i) => {
      const p = `solutions/${NN(d.number)}-${w.expect === 'works_but_wrong' ? 'works-but-wrong' : 'wrong'}-${i + 1}.redis`;
      files.push({ path: `${dirRel}/${p}`, content: ensureNewline(w.script) });
      wrongEntries.push({ path: p, expect: w.expect, because: w.because });
    });
    level.solutions = { reference: refPath, wrong: wrongEntries };
  } else {
    const q = compileQuizzes(d);
    level.verify = q.verify;
    level.reward = { xp: 10 };
    level.solutions = { reference: q.reference.length === 1 ? (q.reference[0] as string) : q.reference, wrong: q.wrong };
  }

  const chapter: Obj = {
    id: pack,
    title: d.chapterTitle,
    incident: d.incident.map((m) => ({ from: m.from, time: m.time, text: m.text })),
    levels: [id],
  };
  files.unshift(
    { path: `${dirRel}/chapter.yaml`, content: toYaml(chapter) },
    { path: `${dirRel}/${stem}.yaml`, content: toYaml(level) },
  );
  return { id, pack, directory: dirRel, files, problems };
}

function ensureNewline(s: string): string {
  return s.endsWith('\n') || s === '' ? s : `${s}\n`;
}

/**
 * The questions a draft's commands must pass before the play-test runs them (it is the engine's job to enforce them;
 * they are here so the rule has one home): no `game:*` argument anywhere.
 */
export function draftCommands(d: { setup?: string; reference?: string; wrong?: { script?: string }[] }): string[][] {
  const texts = [d.setup ?? '', d.reference ?? '', ...(d.wrong ?? []).map((w) => w.script ?? '')];
  return texts.flatMap((t) => lineList(t).map((l) => splitArgsLine(l) ?? [l]));
}
