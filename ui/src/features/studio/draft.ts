// The studio's draft: what the form edits and what is sent to POST /api/studio/validate and /api/studio/playtest.
// The shape mirrors StudioDraft in packages/shared/src/levels/draft.ts (the UI does not import that package: it holds
// Node-only loaders). Pure functions only, so they run under vitest without a DOM.

export type Mode = 'cli' | 'decision';

export const CHECK_KINDS = [
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
export type CheckKind = (typeof CHECK_KINDS)[number];
export type CheckField =
  'key' | 'value' | 'field' | 'member' | 'structure' | 'min' | 'max' | 'command' | 'comparator';

export interface CheckKindInfo {
  kind: CheckKind;
  label: string;
  /** The small form: which fields this kind asks for, in order. */
  fields: readonly CheckField[];
  /** What the check reads, in one line, for the picker. */
  help: string;
}

export const CHECK_KIND_INFO: readonly CheckKindInfo[] = [
  {
    kind: 'type_is',
    label: 'Key has this type',
    fields: ['key', 'value'],
    help: 'TYPE key equals the type you name (zset, hash, list, set, string, stream).',
  },
  { kind: 'exists', label: 'Key exists', fields: ['key'], help: 'EXISTS key equals 1.' },
  {
    kind: 'not_exists',
    label: 'Key does not exist',
    fields: ['key'],
    help: 'EXISTS key equals 0. Tick "works but wrong" to make it an antipattern.',
  },
  {
    kind: 'string_equals',
    label: 'String value equals',
    fields: ['key', 'value'],
    help: 'GET key equals the text.',
  },
  {
    kind: 'number_gte',
    label: 'Number is at least',
    fields: ['key', 'value'],
    help: 'GET key, read as a number, is at least the value.',
  },
  {
    kind: 'size_gte',
    label: 'Collection has at least N items',
    fields: ['key', 'structure', 'value'],
    help: 'LLEN, SCARD, ZCARD, HLEN, XLEN or STRLEN is at least N.',
  },
  {
    kind: 'ttl_between',
    label: 'Key expires within a range',
    fields: ['key', 'min', 'max'],
    help: 'TTL key, in seconds, is between the minimum and the maximum.',
  },
  {
    kind: 'hash_field_equals',
    label: 'Hash field equals',
    fields: ['key', 'field', 'value'],
    help: 'HGET key field equals the text.',
  },
  {
    kind: 'zscore_equals',
    label: 'Sorted-set score equals',
    fields: ['key', 'member', 'value'],
    help: 'ZSCORE key member equals the number.',
  },
  {
    kind: 'set_has',
    label: 'Set contains member',
    fields: ['key', 'member'],
    help: 'SISMEMBER key member equals 1.',
  },
  {
    kind: 'custom',
    label: 'Any read-only command',
    fields: ['command', 'comparator', 'value'],
    help: 'Run a read-only command and compare its reply.',
  },
];

export const STRUCTURES = ['list', 'set', 'zset', 'hash', 'stream', 'string'] as const;
export const COMPARATORS = [
  'equals',
  'notEquals',
  'gte',
  'lte',
  'contains',
  'notContains',
] as const;

export interface DraftCheck {
  kind: CheckKind;
  key: string;
  field: string;
  member: string;
  structure: string;
  value: string;
  min: string;
  max: string;
  command: string;
  comparator: string;
  /** Describes the healthy state; a failure is the "works, but wrong" hit and needs a message. */
  antipattern: boolean;
  message: string;
}

export interface DraftQuizOption {
  label: string;
  correct: boolean;
  /** Why this option is wrong, shown with the model answer. */
  because: string;
}
export interface DraftQuiz {
  question: string;
  explanation: string;
  options: DraftQuizOption[];
}
export interface DraftMessage {
  from: string;
  time: string;
  text: string;
}
export interface DraftWrong {
  script: string;
  expect: 'wrong' | 'works_but_wrong';
  because: string;
}

export interface Draft {
  mode: Mode;
  pack: string;
  number: number;
  slug: string;
  title: string;
  chapterTitle: string;
  incident: DraftMessage[];
  story: string;
  brainstormPrompt: string;
  brainstormOptions: { label: string; reasonable: boolean }[];
  teach: string;
  task: string;
  setup: string;
  hints: string[];
  checks: DraftCheck[];
  quizzes: DraftQuiz[];
  reference: string;
  wrong: DraftWrong[];
  author: { name: string; github: string };
}

export const CAST: readonly { slug: string; name: string }[] = [
  { slug: 'roommate', name: 'Teja (roommate)' },
  { slug: 'senior', name: 'Harry Bhaiya (senior)' },
  { slug: 'warden', name: 'Warden Sir' },
  { slug: 'sms-vendor', name: 'TextTara Sir' },
  { slug: 'rival-college', name: 'Gomti Gang' },
  { slug: 'you', name: 'You' },
];

export function emptyCheck(kind: CheckKind = 'string_equals'): DraftCheck {
  return {
    kind,
    key: '',
    field: '',
    member: '',
    structure: 'list',
    value: '',
    min: '',
    max: '',
    command: '',
    comparator: 'equals',
    antipattern: false,
    message: '',
  };
}

export function emptyQuiz(): DraftQuiz {
  return {
    question: '',
    explanation: '',
    options: [
      { label: '', correct: true, because: '' },
      { label: '', correct: false, because: '' },
    ],
  };
}

export function starterDraft(mode: Mode = 'cli'): Draft {
  return {
    mode,
    pack: '',
    number: 1,
    slug: '',
    title: '',
    chapterTitle: '',
    incident: [
      { from: 'roommate', time: '12:40', text: '' },
      { from: 'you', time: '12:42', text: '' },
    ],
    story: '',
    brainstormPrompt: '',
    brainstormOptions: [
      { label: '', reasonable: true },
      { label: '', reasonable: false },
    ],
    teach: '',
    task: '',
    setup: '',
    hints: [''],
    checks: mode === 'cli' ? [emptyCheck()] : [],
    quizzes: mode === 'decision' ? [emptyQuiz()] : [],
    reference: '',
    wrong: mode === 'cli' ? [{ script: '', expect: 'wrong', because: '' }] : [],
    author: { name: '', github: '' },
  };
}

export const STORAGE_KEY = 'rq:studio:draft';

function str(v: unknown, d: string): string {
  return typeof v === 'string' ? v : d;
}

/** Reads a stored draft defensively: anything that is not the expected shape falls back to the starter's value. */
export function sanitizeDraft(raw: unknown): Draft {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const mode: Mode = r.mode === 'decision' ? 'decision' : 'cli';
  const base = starterDraft(mode);
  const list = <T>(v: unknown, map: (x: Record<string, unknown>) => T, fallback: T[]): T[] =>
    Array.isArray(v)
      ? v.filter((x) => x && typeof x === 'object').map((x) => map(x as Record<string, unknown>))
      : fallback;
  const author = (r.author && typeof r.author === 'object' ? r.author : {}) as Record<
    string,
    unknown
  >;
  return {
    mode,
    pack: str(r.pack, base.pack),
    number:
      typeof r.number === 'number' && Number.isFinite(r.number)
        ? Math.trunc(r.number)
        : base.number,
    slug: str(r.slug, base.slug),
    title: str(r.title, base.title),
    chapterTitle: str(r.chapterTitle, base.chapterTitle),
    incident: list(
      r.incident,
      (m) => ({ from: str(m.from, 'roommate'), time: str(m.time, ''), text: str(m.text, '') }),
      base.incident,
    ),
    story: str(r.story, base.story),
    brainstormPrompt: str(r.brainstormPrompt, base.brainstormPrompt),
    brainstormOptions: list(
      r.brainstormOptions,
      (o) => ({ label: str(o.label, ''), reasonable: o.reasonable === true }),
      base.brainstormOptions,
    ),
    teach: str(r.teach, base.teach),
    task: str(r.task, base.task),
    setup: str(r.setup, base.setup),
    hints: Array.isArray(r.hints)
      ? r.hints.filter((h): h is string => typeof h === 'string')
      : base.hints,
    checks: list(
      r.checks,
      (c) => {
        const kind = CHECK_KINDS.find((k) => k === c.kind) ?? 'string_equals';
        const e = emptyCheck(kind);
        return {
          kind,
          key: str(c.key, e.key),
          field: str(c.field, e.field),
          member: str(c.member, e.member),
          structure: str(c.structure, e.structure),
          value: str(c.value, e.value),
          min: str(c.min, e.min),
          max: str(c.max, e.max),
          command: str(c.command, e.command),
          comparator: str(c.comparator, e.comparator),
          antipattern: c.antipattern === true,
          message: str(c.message, e.message),
        };
      },
      base.checks,
    ),
    quizzes: list(
      r.quizzes,
      (q) => ({
        question: str(q.question, ''),
        explanation: str(q.explanation, ''),
        options: list(
          q.options,
          (o) => ({
            label: str(o.label, ''),
            correct: o.correct === true,
            because: str(o.because, ''),
          }),
          emptyQuiz().options,
        ),
      }),
      base.quizzes,
    ),
    reference: str(r.reference, base.reference),
    wrong: list(
      r.wrong,
      (w) => ({
        script: str(w.script, ''),
        expect: w.expect === 'works_but_wrong' ? 'works_but_wrong' : 'wrong',
        because: str(w.because, ''),
      }),
      base.wrong,
    ),
    author: { name: str(author.name, ''), github: str(author.github, '') },
  };
}

export function loadDraft(): Draft {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? sanitizeDraft(JSON.parse(raw)) : starterDraft();
  } catch {
    return starterDraft();
  }
}

export function saveDraft(d: Draft): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(d));
  } catch {
    /* storage can be blocked or full: the draft just does not survive a reload */
  }
}

/** Switching mode keeps the shared fields and gives the new mode its starter lists. */
export function switchMode(d: Draft, mode: Mode): Draft {
  if (d.mode === mode) return d;
  const base = starterDraft(mode);
  return {
    ...d,
    mode,
    checks: base.checks,
    quizzes: base.quizzes,
    wrong: base.wrong,
    reference: '',
    setup: '',
  };
}

/** The three git commands and where the files go, for "Get the files". */
export function gitSteps(
  pack: string,
  slug: string,
  title: string,
): { branch: string; commands: string[]; folder: string } {
  const branch = `level/${pack}-${slug}`;
  const folder = `levels/community/${pack}`;
  const subject = (title.trim() || slug).replace(/["\\$`]/g, '');
  return {
    branch,
    folder,
    commands: [
      `git checkout -b ${branch}`,
      `git add ${folder}`,
      `git commit -m "Community level: ${subject}"`,
    ],
  };
}

/** A validation error's path (`checks[1].key`, `verify[0].checks[0]`) mapped to the form section that holds it. */
export function sectionOf(
  path: string,
): 'basics' | 'story' | 'task' | 'checks' | 'solution' | 'other' {
  if (/^(pack|number|slug|title|chapterTitle|author|id|chapter|mode)\b/.test(path)) return 'basics';
  if (/^(story|brainstorm|teach|incident)/.test(path)) return 'story';
  if (/^(task|setup|hints)/.test(path)) return 'task';
  if (/^(checks|quizzes|verify)/.test(path)) return 'checks';
  if (/^(reference|wrong|solutions)/.test(path)) return 'solution';
  return 'other';
}
