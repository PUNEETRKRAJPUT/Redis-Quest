// Loads `golf/`: every hole and every entry, with each problem reported as `file:line:col path: message` like the
// level validator does. Nothing here throws on bad content.

import { readdir, readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import type { z } from 'zod';
import {
  compareErrors,
  formatPath,
  parseYaml,
  positionOf,
  type LevelError,
  type PathSegment,
  type YamlSource,
} from '../levels/source.js';
import { handleFromFileName, parseEntry, type ParsedEntry } from './entry.js';
import { HOLE_ID, holeSchema, type Hole } from './schema.js';

export const HOLE_FILE = 'hole.yaml';

export interface LoadedHole {
  id: string;
  /** Absolute path of the hole directory. */
  dir: string;
  hole: Hole;
  entries: ParsedEntry[];
}

export interface LeagueLoadResult {
  holes: LoadedHole[];
  errors: LevelError[];
}

type Issue = z.ZodError['issues'][number];

function issueErrors(issue: Issue, source: YamlSource, data: unknown): LevelError[] {
  const path = issue.path.filter((p): p is PathSegment => typeof p !== 'symbol');
  const at = (p: PathSegment[], message: string, key = false): LevelError => {
    const pos = positionOf(source, p, { key });
    return { file: source.file, line: pos.line, col: pos.col, path: formatPath(p), message };
  };
  if (issue.code === 'unrecognized_keys') {
    return issue.keys.map((k) => at([...path, k], `unknown key '${k}'`, true));
  }
  if (issue.code === 'invalid_type' && valueMissing(data, path)) return [at(path, 'required')];
  return [at(path, issue.message)];
}

function valueMissing(data: unknown, path: readonly PathSegment[]): boolean {
  let cur: unknown = data;
  for (const seg of path) {
    if (cur === null || typeof cur !== 'object') return false;
    cur = (cur as Record<string, unknown>)[seg as string];
  }
  return cur === undefined;
}

const fileError = (file: string, message: string, path = '(root)'): LevelError => ({
  file,
  line: 1,
  col: 1,
  path,
  message,
});

/** Parses and validates one hole file's text. Pure: the loader and the tests share it. */
export function parseHole(file: string, text: string): { hole?: Hole; errors: LevelError[] } {
  const parsed = parseYaml(file, text);
  if (parsed.errors.length) return { errors: parsed.errors };
  const result = holeSchema.safeParse(parsed.data);
  if (!result.success) {
    return {
      errors: result.error.issues.flatMap((i) => issueErrors(i, parsed.source, parsed.data)),
    };
  }
  return { hole: result.data, errors: [] };
}

async function readDir(dir: string): Promise<string[] | null> {
  try {
    return (await readdir(dir)).sort();
  } catch {
    return null;
  }
}

async function loadEntries(entriesDir: string, errors: LevelError[]): Promise<ParsedEntry[]> {
  const names = await readDir(entriesDir);
  if (names === null) return [];
  const entries: ParsedEntry[] = [];
  const seen = new Map<string, string>();
  for (const name of names) {
    if (name.startsWith('.')) continue;
    const file = join(entriesDir, name);
    const handle = handleFromFileName(name);
    if (handle === null) {
      errors.push(
        fileError(
          file,
          `entry files are named <github-handle>.redis (letters, digits, single hyphens); '${name}' is not`,
        ),
      );
      continue;
    }
    const lower = handle.toLowerCase();
    const earlier = seen.get(lower);
    if (earlier !== undefined) {
      errors.push(
        fileError(
          file,
          `'${handle}' and '${earlier}' are the same GitHub handle; one entry per person per hole`,
        ),
      );
      continue;
    }
    seen.set(lower, handle);
    let text: string;
    try {
      text = await readFile(file, 'utf8');
    } catch (e) {
      errors.push(fileError(file, `cannot read file: ${(e as Error).message}`));
      continue;
    }
    const r = parseEntry(handle, text, file);
    errors.push(...r.errors);
    if (r.entry) entries.push(r.entry);
  }
  return entries;
}

/** Loads every hole under `<root>/holes/`. A missing `golf` directory is one error, not an exception. */
export async function loadLeague(root: string): Promise<LeagueLoadResult> {
  const base = resolve(root);
  const holesDir = join(base, 'holes');
  const errors: LevelError[] = [];
  const names = await readDir(holesDir);
  if (names === null) {
    return { holes: [], errors: [fileError(holesDir, 'there is no holes/ directory here')] };
  }
  const holes: LoadedHole[] = [];
  for (const name of names) {
    if (name.startsWith('.')) continue;
    const dir = join(holesDir, name);
    if (!(await readDir(dir))) {
      errors.push(fileError(dir, `only hole directories belong in holes/; '${name}' is a file`));
      continue;
    }
    if (!HOLE_ID.test(name)) {
      errors.push(
        fileError(dir, `a hole directory is named <nn>-<slug> like 01-bulk-load; '${name}' is not`),
      );
      continue;
    }
    const file = join(dir, HOLE_FILE);
    let text: string;
    try {
      text = await readFile(file, 'utf8');
    } catch {
      errors.push(fileError(file, `${HOLE_FILE} is missing`));
      continue;
    }
    const parsed = parseHole(file, text);
    errors.push(...parsed.errors);
    const entries = await loadEntries(join(dir, 'entries'), errors);
    if (parsed.hole) holes.push({ id: name, dir, hole: parsed.hole, entries });
  }
  errors.sort(compareErrors);
  return { holes, errors };
}
