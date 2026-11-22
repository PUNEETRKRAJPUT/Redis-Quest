// Which Redis commands a level uses, read from its own files (D-06). Pure functions first, one file reader last.
//
// WHAT COUNTS AS "TAUGHT" (docs/handoffs/D-06.md says the same): a command is taught when
//   1. a level's reference solution runs it (a `.redis` or `.sh` script line, or a call on the learner's `redis`
//      client in a `.js` solution, including `redis.call('X')` inside a Lua script the solution sends), or
//   2. a check of the level runs it: `redis` and `antipattern` checks, a behavior `sideEffect`, and the command an
//      `answer` verifier reads its expected value with.
// Not counted: setup steps (they only build the scene), the known-wrong solutions (a player is shown them as the
// thing not to do), decision levels' option ids, and anything inside prose. Only top-level names are recorded
// (`XGROUP CREATE` counts for `xgroup`), because the board lists top-level commands.
import { readFile } from 'node:fs/promises';
import {
  resolveLevelPath,
  splitCommandLine,
  type LevelFile,
  type LoadedLevel,
  type VerifySpec,
} from '@quest/shared';

/** The first word of an argv, lowercase, or null for an empty or templated name. */
export function commandName(first: string | undefined): string | null {
  if (first === undefined) return null;
  const name = first.trim().toLowerCase();
  if (name === '' || name.includes('{{') || !/^[a-z0-9_.-]+$/.test(name)) return null;
  return name;
}

/** Commands of a `.redis` script: the first word of every command line. */
export function commandsInRedisScript(text: string): string[] {
  return splitCommandLine(text)
    .map((argv) => commandName(argv[0]))
    .filter((n): n is string => n !== null);
}

/** Commands of a `.sh` script: the word after `redis-cli` (and its flags), on every line that has one. */
export function commandsInShell(text: string): string[] {
  const out: string[] = [];
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (line.startsWith('#')) continue;
    const m = /\bredis-cli\b((?:\s+-\S+(?:\s+\d+)?)*)\s+([A-Za-z][A-Za-z0-9_.-]*)/.exec(line);
    const n = commandName(m?.[2]);
    if (n) out.push(n);
  }
  return out;
}

/** Index just past the `)` that closes the `(` at `open`, skipping quoted strings; -1 when it never closes. */
function skipParens(text: string, open: number): number {
  let depth = 0;
  for (let i = open; i < text.length; i++) {
    const c = text[i] as string;
    if (c === '"' || c === "'" || c === '`') {
      for (i++; i < text.length && text[i] !== c; i++) if (text[i] === '\\') i++;
    } else if (c === '(') depth++;
    else if (c === ')' && --depth === 0) return i + 1;
  }
  return -1;
}

/**
 * Longest command name that is a prefix of a node-redis method name, lowercased: `zIncrBy` is `zincrby`,
 * `xGroupCreate` credits `xgroup`, `zRangeWithScores` credits `zrange`. The caller only passes names called on the
 * learner's redis client, so the loose match cannot pick up `Map.get` or `Object.keys`.
 */
export function methodToCommand(method: string, known: ReadonlySet<string>): string | null {
  const lower = method.toLowerCase();
  if (known.has(lower)) return lower;
  let best: string | null = null;
  for (const name of known) {
    if (name.length >= 2 && lower.startsWith(name) && (best === null || name.length > best.length))
      best = name;
  }
  return best;
}

/**
 * Commands of a `.js` solution: calls on `redis` (and on a connection made with `redis.duplicate()`), the whole
 * `redis.multi().a().b().exec()` chain, `sendCommand(['XADD', ...])` and `redis.call('GET', ...)` inside a Lua
 * script string. `known` is the server's own list of top-level command names (lowercase); a method that is not a
 * command (`connect`, `duplicate`, `on`) matches nothing and is dropped.
 */
export function commandsInCode(text: string, known: ReadonlySet<string>): string[] {
  const out = new Set<string>();
  const add = (n: string | null) => {
    if (n !== null && known.has(n)) out.add(n);
  };
  for (const m of text.matchAll(/\bredis\.p?call\(\s*['"]([A-Za-z][A-Za-z0-9_.-]*)['"]/g))
    add(commandName(m[1]));
  for (const m of text.matchAll(/\bsendCommand\(\s*\[\s*['"]([A-Za-z][A-Za-z0-9_.-]*)['"]/g))
    add(commandName(m[1]));

  const receivers = new Set(['redis']);
  for (const m of text.matchAll(
    /\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:await\s+)?redis\.duplicate\(\)/g,
  ))
    receivers.add(m[1] as string);

  const start = new RegExp(`\\b(?:${[...receivers].join('|')})\\s*\\.\\s*([A-Za-z]\\w*)\\s*\\(`, 'g');
  for (const m of text.matchAll(start)) {
    if (/^(call|pcall|sendCommand|duplicate)$/.test(m[1] as string)) continue;
    add(methodToCommand(m[1] as string, known));
    // A chain (`multi().hSet().expire().exec()`) keeps calling on the result: follow it.
    let at = (m.index ?? 0) + m[0].length - 1;
    for (;;) {
      const end = skipParens(text, at);
      if (end < 0) break;
      const next = /^\s*\.\s*([A-Za-z]\w*)\s*\(/.exec(text.slice(end));
      if (!next) break;
      add(methodToCommand(next[1] as string, known));
      at = end + next[0].length - 1;
    }
  }
  return [...out];
}

/** Commands the checks of a level run (see the file header for which checks). */
export function commandsInChecks(verify: readonly VerifySpec[]): string[] {
  const out: string[] = [];
  const take = (argv: readonly string[] | undefined) => {
    const n = commandName(argv?.[0]);
    if (n) out.push(n);
  };
  for (const v of verify) {
    if (v.type === 'redis') v.checks.forEach((c) => take(c.cmd));
    else if (v.type === 'antipattern') {
      if ('checks' in v) v.checks.forEach((c) => take(c.cmd));
      else v.assertions.forEach((a) => a.sideEffect?.forEach((c) => take(c.cmd)));
    } else if (v.type === 'behavior') v.assertions.forEach((a) => a.sideEffect?.forEach((c) => take(c.cmd)));
    else if (v.type === 'answer') take(v.expected.cmd);
  }
  return out;
}

/** Where a command was seen: the level that uses it and how. */
export interface UsedBy {
  levelId: string;
  via: 'solution' | 'check';
}

/** Command name to the levels that use it, in the order they were read. */
export type Usage = Map<string, UsedBy[]>;

function record(usage: Usage, names: Iterable<string>, levelId: string, via: UsedBy['via']): void {
  for (const name of names) {
    const list = usage.get(name) ?? [];
    if (!list.some((u) => u.levelId === levelId && u.via === via)) list.push({ levelId, via });
    usage.set(name, list);
  }
}

type FileReader = (path: string) => Promise<string>;
const readText: FileReader = (p) => readFile(p, 'utf8');

/** Adds what one level uses to `usage`. A solution file that cannot be read is skipped (the loader reports it). */
export async function addLevelUsage(
  usage: Usage,
  loaded: Pick<LoadedLevel, 'dir'> & { level: LevelFile },
  known: ReadonlySet<string>,
  read: FileReader = readText,
): Promise<void> {
  const level = loaded.level;
  record(usage, commandsInChecks(level.verify), level.id, 'check');
  const reference = level.mode === 'decision' ? undefined : level.solutions?.reference;
  if (typeof reference !== 'string') return;
  let text: string;
  try {
    text = await read(resolveLevelPath(loaded, reference));
  } catch {
    return;
  }
  const names = reference.endsWith('.redis')
    ? commandsInRedisScript(text)
    : reference.endsWith('.sh')
      ? commandsInShell(text)
      : commandsInCode(text, known);
  record(
    usage,
    names.filter((n) => known.has(n)),
    level.id,
    'solution',
  );
}
