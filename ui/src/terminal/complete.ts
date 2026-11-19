// Completion maths for the terminal line: which word is under the cursor, which commands match it, and which
// argument of the command's documented syntax the cursor is at. Pure functions, no DOM, no network.
import { isCoreName, isModuleDoc, type ArgDoc, type CommandDoc, type DocState } from './docs';

// ---- the line -------------------------------------------------------------------------------------------------

export interface Word {
  text: string;
  start: number;
  end: number;
}

/** Splits like a shell would for display purposes: whitespace separates, quotes keep a word together. */
export function splitWords(line: string): Word[] {
  const out: Word[] = [];
  let i = 0;
  while (i < line.length) {
    while (i < line.length && /\s/.test(line[i] as string)) i++;
    if (i >= line.length) break;
    const start = i;
    let quote: string | null = null;
    while (i < line.length) {
      const c = line[i] as string;
      if (quote) {
        if (c === '\\') i++;
        else if (c === quote) quote = null;
      } else if (c === '"' || c === "'") quote = c;
      else if (/\s/.test(c)) break;
      i++;
    }
    out.push({
      text: line.slice(start, Math.min(i, line.length)),
      start,
      end: Math.min(i, line.length),
    });
  }
  return out;
}

export interface Cursor {
  /** Words that end before the cursor (the complete ones). */
  before: Word[];
  /** Index of the word the cursor is in or at the end of; equals `before.length`. */
  index: number;
  /** The part of that word left of the cursor ('' when the cursor starts a new word). */
  prefix: string;
  /** Where that word starts (the cursor itself when it starts a new word) and ends. */
  wordStart: number;
  wordEnd: number;
}

export function cursorInfo(line: string, cursor: number): Cursor {
  const words = splitWords(line);
  const before: Word[] = [];
  let at: Word | null = null;
  for (const w of words) {
    if (w.end < cursor) before.push(w);
    else if (w.start <= cursor) at = w;
  }
  // The cursor sits right after a word with no space (w.end === cursor) or inside it: that word is being typed.
  return {
    before,
    index: before.length,
    prefix: at ? line.slice(at.start, cursor) : '',
    wordStart: at ? at.start : cursor,
    wordEnd: at ? at.end : cursor,
  };
}

// ---- command candidates ---------------------------------------------------------------------------------------

export interface Candidate {
  /** Lowercase name from the server: `get`, `client|list`. */
  name: string;
  /** What is typed for it: `GET`, or `LIST` for a subcommand. */
  word: string;
  /** Characters of `word` that match the typed prefix, from the start (for emphasis). */
  matchLen: number;
  summary: string;
  group: string;
  /** True when a command has subcommands (its docs say so once loaded). */
  container: boolean;
}

export const MAX_ROWS = 8;

function candidate(name: string, prefix: string, doc: DocState, word: string): Candidate {
  const d = doc && doc !== 'missing' ? doc : null;
  return {
    name,
    word: word.toUpperCase(),
    matchLen: word.toLowerCase().startsWith(prefix.toLowerCase()) ? prefix.length : 0,
    summary: d?.summary ?? '',
    group: d?.group ?? '',
    container: d ? Object.keys(d.subcommands).length > 0 : false,
  };
}

/**
 * Names that start with the typed prefix (then, from three typed characters on, names that merely contain it),
 * exact match first, then shorter names, then alphabetical: no popularity table, only what the server lists.
 * Subcommand names (`client|list`) are not offered for the first word.
 */
export function commandCandidates(
  prefix: string,
  names: readonly string[],
  doc: (name: string) => DocState,
  limit = MAX_ROWS,
): Candidate[] {
  const p = prefix.toLowerCase();
  if (!p) return [];
  const pool = names.filter((n) => !n.includes('|') && isCoreName(n));
  const starts = pool.filter((n) => n.startsWith(p));
  const contains = p.length >= 3 ? pool.filter((n) => !n.startsWith(p) && n.includes(p)) : [];
  const rank = (a: string, b: string) =>
    Number(b === p) - Number(a === p) || a.length - b.length || (a < b ? -1 : 1);
  starts.sort(rank);
  contains.sort(rank);
  const out: Candidate[] = [];
  for (const n of [...starts, ...contains]) {
    const d = doc(n);
    if (d && d !== 'missing' && isModuleDoc(d)) continue;
    out.push(candidate(n, p, d, n));
    if (out.length >= limit) break;
  }
  return out;
}

/** Subcommands of a container command that start with the typed prefix, in the server's own order. */
export function subcommandCandidates(
  parent: CommandDoc,
  prefix: string,
  names: readonly string[],
  limit = MAX_ROWS,
): Candidate[] {
  const p = prefix.toLowerCase();
  const out: Candidate[] = [];
  const fromDoc = Object.keys(parent.subcommands);
  const all = fromDoc.length ? fromDoc : names.filter((n) => n.startsWith(`${parent.name}|`));
  const sorted = [...all].sort();
  for (const full of sorted) {
    const word = full.slice(parent.name.length + 1);
    if (!word.toLowerCase().startsWith(p)) continue;
    const sub = parent.subcommands[full];
    out.push({
      name: full,
      word: word.toUpperCase(),
      matchLen: p.length,
      summary: sub?.summary ?? '',
      group: sub?.group ?? parent.group ?? '',
      container: false,
    });
    if (out.length >= limit) break;
  }
  return out;
}

/** The line after accepting a candidate: the word under the cursor replaced, a space after it. */
export function accept(
  line: string,
  cursor: number,
  c: Pick<Candidate, 'word'>,
): { line: string; cursor: number } {
  const info = cursorInfo(line, cursor);
  const head = line.slice(0, info.wordStart);
  const tail = line.slice(info.wordEnd).replace(/^\s+/, '');
  const next = `${head}${c.word} ${tail}`;
  return { line: next, cursor: head.length + c.word.length + 1 };
}

// ---- syntax at the cursor -------------------------------------------------------------------------------------

export type SegState = 'done' | 'active' | 'idle';

export interface Seg {
  text: string;
  kind: 'cmd' | 'token' | 'arg' | 'punct';
  state: SegState;
}

export interface Syntax {
  segs: Seg[];
  /** True when the typed words run past what the documentation describes. */
  extra: boolean;
}

interface Walk {
  words: string[];
  pos: number;
  done: Set<ArgDoc>;
  active: ArgDoc | null;
  /** The sequence ran out of words: nothing after this point has been typed. */
  ended: boolean;
}

const eq = (a: string, b: string | undefined) =>
  b !== undefined && a.toLowerCase() === b.toLowerCase();

/** Tokens that appear later in a sequence, so a "multiple" positional knows where to stop. */
function laterTokens(rest: ArgDoc[]): string[] {
  const out: string[] = [];
  const visit = (a: ArgDoc) => {
    if (a.token) out.push(a.token);
    if (a.type === 'oneof' || a.type === 'block') a.arguments.forEach(visit);
  };
  rest.forEach(visit);
  return out;
}

function matchesToken(a: ArgDoc, w: string): boolean {
  if (a.token) return eq(w, a.token);
  if (a.type === 'oneof') return a.arguments.some((x) => matchesToken(x, w));
  if (a.type === 'block') return a.arguments[0] ? matchesToken(a.arguments[0], w) : false;
  return false;
}

/** True when the argument can only begin with one of its own literal words (NX, EX, LIMIT, FULL ...). */
function startsWithToken(a: ArgDoc): boolean {
  if (a.token !== undefined) return true;
  if (a.type === 'oneof') return a.arguments.length > 0 && a.arguments.every(startsWithToken);
  if (a.type === 'block') return a.arguments[0] ? startsWithToken(a.arguments[0]) : false;
  return false;
}

/**
 * The cursor is past everything typed. What to point at: this argument if it is required; if it is optional, the
 * next required one after it (what the command needs), and only when nothing is required any more, this option.
 */
function pickActive(a: ArgDoc, rest: ArgDoc[]): ArgDoc {
  if (!a.optional) return a;
  return rest.find((x) => !x.optional) ?? a;
}

function consume(a: ArgDoc, rest: ArgDoc[], s: Walk): void {
  if (s.ended) return;
  if (s.pos >= s.words.length) {
    s.active = pickActive(a, rest);
    s.ended = true;
    return;
  }
  const w = s.words[s.pos] as string;
  const tokenised = a.token !== undefined;

  // An argument that starts with its own word (EX seconds, LIMIT offset count, a bare NX).
  if (tokenised) {
    if (!eq(w, a.token)) {
      if (a.optional) return;
      s.active = a;
      s.ended = true;
      return;
    }
    s.pos++;
    s.done.add(a);
    if (a.type === 'pure-token') return after(a, rest, s);
    if (a.type === 'block' || a.type === 'oneof') {
      body(a, rest, s);
    } else if (s.pos >= s.words.length) {
      s.active = a;
      s.ended = true;
      return;
    } else s.pos++;
    return after(a, rest, s);
  }

  if (a.type === 'oneof') {
    const alt = a.arguments.find((x) => matchesToken(x, w));
    if (!alt) {
      if (a.optional) return;
      // A oneof of plain values (no tokens): take the word as one of them.
      if (a.arguments.every((x) => x.token === undefined)) {
        s.pos++;
        s.done.add(a);
        return after(a, rest, s);
      }
      s.active = a;
      s.ended = true;
      return;
    }
    s.done.add(a);
    consume(alt, rest, s);
    return after(a, rest, s);
  }

  if (a.type === 'block') {
    if (a.optional && startsWithToken(a) && !matchesToken(a, w)) return;
    s.done.add(a);
    body(a, rest, s);
    return after(a, rest, s);
  }

  // A plain value.
  s.pos++;
  s.done.add(a);
  after(a, rest, s);
}

/** The children of a block in order; what follows the block stays visible to them (to stop repeats, to point ahead). */
function body(a: ArgDoc, outer: ArgDoc[], s: Walk) {
  a.arguments.forEach((x, i) => consume(x, [...a.arguments.slice(i + 1), ...outer], s));
}

/** Handles `multiple`: the argument may repeat, as long as the next word is not a later argument's token. */
function after(a: ArgDoc, rest: ArgDoc[], s: Walk): void {
  if (s.ended || !a.multiple) return;
  const stop = laterTokens(rest);
  for (;;) {
    if (s.pos >= s.words.length) {
      s.active = a;
      s.ended = true;
      return;
    }
    const w = s.words[s.pos] as string;
    if (stop.some((t) => eq(w, t))) return;
    if (a.token && a.multipleToken) {
      if (!eq(w, a.token)) return;
    }
    const before = s.pos;
    if (a.token && a.multipleToken) {
      s.pos++;
      if (a.type !== 'pure-token') s.pos++;
    } else if (a.type === 'block') body(a, rest, s);
    else s.pos++;
    if (s.pos === before) return;
  }
}

function render(
  args: ArgDoc[],
  walk: Walk,
  segs: Seg[],
  gap: boolean,
  inheritedState?: SegState,
): void {
  args.forEach((a, i) => {
    if (gap || i > 0)
      segs.push({ text: ' ', kind: 'punct', state: gap ? 'idle' : (inheritedState ?? 'idle') });
    renderOne(a, walk, segs, inheritedState);
  });
}

function stateOf(a: ArgDoc, walk: Walk, inherited?: SegState): SegState {
  if (walk.active === a) return 'active';
  if (inherited) return inherited;
  return walk.done.has(a) ? 'done' : 'idle';
}

function renderOne(a: ArgDoc, walk: Walk, segs: Seg[], inherited?: SegState): void {
  const st = stateOf(a, walk, inherited);
  const open = a.optional ? '[' : '';
  const close = a.optional ? ']' : '';
  if (open) segs.push({ text: open, kind: 'punct', state: st });
  if (a.type === 'oneof') {
    a.arguments.forEach((alt, i) => {
      if (i > 0)
        segs.push({ text: ' | ', kind: 'punct', state: st === 'active' ? 'active' : 'idle' });
      renderOne(alt, walk, segs, st === 'active' ? 'active' : undefined);
    });
  } else if (a.type === 'block') {
    if (a.token) {
      segs.push({ text: a.token, kind: 'token', state: st });
      segs.push({ text: ' ', kind: 'punct', state: st });
    }
    render(a.arguments, walk, segs, false, st === 'active' ? 'active' : undefined);
  } else {
    if (a.token) {
      segs.push({ text: a.token, kind: 'token', state: st });
      if (a.type !== 'pure-token') segs.push({ text: ' ', kind: 'punct', state: st });
    }
    if (a.type !== 'pure-token') segs.push({ text: a.label, kind: 'arg', state: st });
  }
  if (a.multiple && a.type !== 'oneof') {
    const unit = a.type === 'block' ? a.arguments.map((x) => x.label).join(' ') : a.label;
    const rep = a.multipleToken && a.token ? `[${a.token} ${unit} ...]` : `[${unit} ...]`;
    segs.push({ text: ' ', kind: 'punct', state: st });
    segs.push({ text: rep, kind: 'punct', state: st === 'done' ? 'done' : 'idle' });
  }
  if (close) segs.push({ text: close, kind: 'punct', state: st });
}

/**
 * The documented syntax of a command with the argument at the cursor marked. `typed` are the complete words
 * after the command name (up to the cursor); the word being typed is the one the cursor fills in.
 */
export function syntaxAt(doc: CommandDoc, display: string, typed: string[]): Syntax {
  const walk: Walk = { words: typed, pos: 0, done: new Set(), active: null, ended: false };
  doc.arguments.forEach((a, i) => consume(a, doc.arguments.slice(i + 1), walk));
  const segs: Seg[] = [{ text: display, kind: 'cmd', state: 'done' }];
  render(doc.arguments, walk, segs, true);
  return { segs, extra: !walk.ended && walk.pos < typed.length };
}

// ---- putting it together --------------------------------------------------------------------------------------

export type Assist =
  | { kind: 'none' }
  | { kind: 'commands'; items: Candidate[]; wordStart: number; prefix: string }
  | { kind: 'subcommands'; items: Candidate[]; wordStart: number; prefix: string };

export interface AssistInput {
  line: string;
  cursor: number;
  names: readonly string[] | null;
  doc: (name: string) => DocState;
  /** The word the player closed the popup on (Escape); it stays closed until that word changes. */
  dismissed?: string | null;
}

export function assistFor(inp: AssistInput): Assist {
  if (!inp.names) return { kind: 'none' };
  const info = cursorInfo(inp.line, inp.cursor);
  if (info.index === 0) {
    if (!info.prefix || info.prefix === inp.dismissed) return { kind: 'none' };
    // A cursor in the middle of a word still completes the part before it; the whole word is replaced on accept.
    const items = commandCandidates(info.prefix, inp.names, inp.doc);
    if (items.length === 0) return { kind: 'none' };
    // The word is already exactly one command and nothing else matches: nothing left to offer.
    if (items.length === 1 && items[0]?.word.toLowerCase() === info.prefix.toLowerCase())
      return { kind: 'none' };
    return { kind: 'commands', items, wordStart: info.wordStart, prefix: info.prefix };
  }
  if (info.index === 1) {
    const first = info.before[0]?.text.toLowerCase() ?? '';
    const parent = inp.doc(first);
    if (!parent || parent === 'missing' || Object.keys(parent.subcommands).length === 0)
      return { kind: 'none' };
    if (info.prefix && info.prefix === inp.dismissed) return { kind: 'none' };
    const items = subcommandCandidates(parent, info.prefix, inp.names);
    if (items.length === 0) return { kind: 'none' };
    if (
      items.length === 1 &&
      info.prefix &&
      items[0]?.word.toLowerCase() === info.prefix.toLowerCase()
    )
      return { kind: 'none' };
    return { kind: 'subcommands', items, wordStart: info.wordStart, prefix: info.prefix };
  }
  return { kind: 'none' };
}

export interface Hint {
  syntax: Syntax;
  summary: string;
  complexity?: string;
  since?: string;
  group?: string;
  /** The command words as the player typed them, upper-cased: `CLIENT LIST`. */
  title: string;
}

/** The one-line syntax hint for the command on the line, or null when it is unknown or not loaded. */
export function hintFor(
  line: string,
  cursor: number,
  doc: (name: string) => DocState,
): Hint | null {
  const info = cursorInfo(line, cursor);
  // `GET` typed without a space yet is already a whole command: show its syntax straight away.
  const first: { text: string } | null =
    info.before[0] ??
    (info.index === 0 && info.prefix && doc(info.prefix.toLowerCase())
      ? { text: info.prefix }
      : null);
  if (!first) return null;
  const d0 = doc(first.text.toLowerCase());
  if (!d0 || d0 === 'missing') return null;
  let d: CommandDoc = d0;
  let display = first.text.toUpperCase();
  let skip = 1;
  // `CLIENT LIST`: the second word picks a subcommand, whose own arguments are the syntax.
  if (Object.keys(d0.subcommands).length > 0) {
    const second = info.before[1];
    if (!second) {
      return {
        syntax: {
          segs: [
            { text: display, kind: 'cmd', state: 'done' },
            { text: ' ', kind: 'punct', state: 'idle' },
            { text: 'subcommand', kind: 'arg', state: 'active' },
          ],
          extra: false,
        },
        summary: d0.summary,
        ...(d0.complexity ? { complexity: d0.complexity } : {}),
        ...(d0.since ? { since: d0.since } : {}),
        ...(d0.group ? { group: d0.group } : {}),
        title: display,
      };
    }
    const sub = d0.subcommands[`${d0.name}|${second.text.toLowerCase()}`];
    if (!sub) return null;
    d = sub;
    display = `${display} ${second.text.toUpperCase()}`;
    skip = 2;
  }
  const typed = info.before.slice(skip).map((w) => w.text);
  return {
    syntax: syntaxAt(d, display, typed),
    summary: d.summary,
    ...(d.complexity ? { complexity: d.complexity } : {}),
    ...(d.since ? { since: d.since } : {}),
    ...(d.group ? { group: d.group } : {}),
    title: display,
  };
}

/** Selection moves within the rows without wrapping past the ends being surprising: it wraps, like a menu. */
export function moveSelection(count: number, index: number, delta: number): number {
  if (count <= 0) return 0;
  return (((index + delta) % count) + count) % count;
}
