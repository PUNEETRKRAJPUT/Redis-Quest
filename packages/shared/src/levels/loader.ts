// Loads and validates level files. Nothing here throws on bad content: every problem becomes a
// LevelError with a file, line and column, so the validator can print all of them at once and
// the engine can refuse to start with a precise list.

import { readdir, readFile, stat } from 'node:fs/promises';
import { basename, dirname, extname, join, relative, resolve, isAbsolute } from 'node:path';
import type { z } from 'zod';
import {
  chapterSchema,
  fixtureFileSchema,
  LEVEL_FILE_NAME,
  levelFileSchema,
  type Chapter,
  type LevelFile,
} from './schema.js';
import {
  compareErrors,
  formatPath,
  locate,
  offsetToPosition,
  parseYaml,
  positionOf,
  stringScalars,
  textPosition,
  valueAt,
  type LevelError,
  type PathSegment,
  type YamlSource,
} from './source.js';
import { isKnownTemplateVariable, scanTemplate, TEMPLATE_VARIABLES } from './template.js';

/** The chapter directories PLAN.md defines, in play order. Their chapter id is the part before the first dash. */
export const CANONICAL_CHAPTER_DIRS = [
  'ch0-boot',
  'ch1-keyspace',
  'ch2-everyone-showed-up',
  'ch3-compete-and-talk',
  'ch4-work-in-the-background',
  'ch4b-on-call',
  'ch5-survive',
  'finale',
] as const;

export const CHAPTER_FILE = 'chapter.yaml';
const MARKDOWN_FIELDS = ['story', 'teach', 'task'] as const;
type MarkdownField = (typeof MARKDOWN_FIELDS)[number];

export interface LoadedLevel {
  level: LevelFile;
  /** Absolute path of the level YAML file. */
  file: string;
  /** Directory of the level file; every relative path in the level resolves against it. */
  dir: string;
  chapterId: string;
  /** Absolute paths of markdown fields that were loaded from `{ file: ... }`, for error messages and hot reload. */
  sources: Partial<Record<MarkdownField, string>>;
}

export interface LoadedChapter {
  chapter: Chapter;
  /** Same as `chapter.id`. */
  id: string;
  /** Absolute path of the chapter directory. */
  dir: string;
  /** Directory name, e.g. `ch1-keyspace`. */
  dirName: string;
  /** Absolute path of `chapter.yaml`. */
  file: string;
  /** Valid levels in the order `chapter.yaml` lists them. Invalid levels are left out (and reported in errors). */
  levels: LoadedLevel[];
}

export interface ChapterLoadResult {
  /** Present when `chapter.yaml` itself is valid, even if some levels are not. */
  chapter?: LoadedChapter;
  errors: LevelError[];
}

export interface LevelsLoadResult {
  /** Canonical chapters first in play order, then any others by path. */
  chapters: LoadedChapter[];
  errors: LevelError[];
}

/** Resolves `p` against `dir`, the way every relative path in a level is resolved. */
export function resolveLevelPath(loaded: Pick<LoadedLevel, 'dir'>, p: string): string {
  return resolve(loaded.dir, p);
}

// ---------------------------------------------------------------------------------------------
// Errors

type Issue = z.ZodError['issues'][number];

function describe(v: unknown): string {
  if (v === null) return 'null';
  if (Array.isArray(v)) return 'a list';
  if (typeof v === 'object') return 'a map';
  return `${typeof v} ${JSON.stringify(v)}`;
}

function issueToErrors(issue: Issue, source: YamlSource, data: unknown): LevelError[] {
  const path = issue.path.filter((p): p is PathSegment => typeof p !== 'symbol');
  const at = (p: PathSegment[], message: string, key = false): LevelError => {
    const pos = positionOf(source, p, { key });
    return { file: source.file, line: pos.line, col: pos.col, path: formatPath(p), message };
  };
  const raw = valueAt(data, path);

  switch (issue.code) {
    case 'unrecognized_keys':
      return issue.keys.map((k) => at([...path, k], `unknown key '${k}'`, true));
    case 'invalid_type': {
      if (raw === undefined) return [at(path, 'required')];
      let message = `expected ${issue.expected}, got ${describe(raw)}`;
      if (issue.message && !issue.message.startsWith('Invalid input')) message = `${issue.message} (got ${describe(raw)})`;
      const offset = locate(source, path).offset;
      if (typeof raw === 'object' && source.text.startsWith('{{', offset)) {
        message += '; a value starting with {{ must be quoted in YAML';
      }
      return [at(path, message)];
    }
    case 'invalid_union': {
      if ('note' in issue && issue.note === 'No matching discriminator') {
        const options = ((issue as { options?: unknown[] }).options ?? []).map(String).join(', ');
        const field = String(path[path.length - 1] ?? 'value');
        if (raw === undefined) return [at(path, `required (one of: ${options})`)];
        return [at(path, `unknown ${field} ${JSON.stringify(raw)} (expected one of: ${options})`)];
      }
      if (raw === undefined) return [at(path, 'required')];
      return [at(path, issue.message)];
    }
    case 'invalid_value': {
      if (issue.message.startsWith('Invalid')) {
        return [at(path, `expected one of: ${issue.values.map((v) => String(v)).join(', ')} (got ${describe(raw)})`)];
      }
      return [at(path, issue.message)];
    }
    case 'too_small': {
      if (!issue.message.startsWith('Too small')) return [at(path, issue.message)];
      const n = String(issue.minimum);
      if (issue.origin === 'array') return [at(path, `must have at least ${n} item(s)`)];
      if (issue.origin === 'string') return [at(path, `must be at least ${n} character(s)`)];
      return [at(path, `must be ${issue.inclusive ? '>=' : '>'} ${n}`)];
    }
    case 'too_big': {
      if (!issue.message.startsWith('Too big')) return [at(path, issue.message)];
      const n = String(issue.maximum);
      if (issue.origin === 'array') return [at(path, `must have at most ${n} item(s)`)];
      return [at(path, `must be ${issue.inclusive ? '<=' : '<'} ${n}`)];
    }
    default:
      return [at(path, issue.message)];
  }
}

function zodErrors(error: z.ZodError, source: YamlSource, data: unknown): LevelError[] {
  return error.issues.flatMap((i) => issueToErrors(i, source, data));
}

function fileError(file: string, message: string, path = '(root)'): LevelError {
  return { file, line: 1, col: 1, path, message };
}

// ---------------------------------------------------------------------------------------------
// Templates

const ALLOWED_VARS = TEMPLATE_VARIABLES.map((v) => `{{${v}}}`).join(', ');

function templateProblems(value: string): { start: number; needle: string; message: string }[] {
  const out: { start: number; needle: string; message: string }[] = [];
  for (const t of scanTemplate(value)) {
    if (t.kind === 'var' && !isKnownTemplateVariable(t.name)) {
      out.push({ start: t.start, needle: t.raw, message: `unknown template variable {{${t.name}}} (allowed: ${ALLOWED_VARS})` });
    } else if (t.kind === 'unterminated') {
      out.push({ start: t.start, needle: '{{', message: 'unterminated {{ (close it with }}, or write \\{{ for a literal)' });
    }
  }
  return out;
}

/** Template problems in every string of a YAML file, positioned on the variable when it can be found verbatim. */
function yamlTemplateErrors(source: YamlSource): LevelError[] {
  const errors: LevelError[] = [];
  for (const s of stringScalars(source)) {
    let searchFrom = s.range[0];
    for (const p of templateProblems(s.value)) {
      const idx = source.text.indexOf(p.needle, searchFrom);
      const offset = idx !== -1 && idx < s.range[1] ? idx : s.range[0];
      if (idx !== -1 && idx < s.range[1]) searchFrom = idx + p.needle.length;
      const pos = offsetToPosition(source.lineCounter, offset);
      errors.push({ file: source.file, line: pos.line, col: pos.col, path: formatPath(s.path), message: p.message });
    }
  }
  return errors;
}

function textTemplateErrors(file: string, text: string, path: string): LevelError[] {
  return templateProblems(text).map((p) => {
    const pos = textPosition(text, p.start);
    return { file, line: pos.line, col: pos.col, path, message: p.message };
  });
}

// ---------------------------------------------------------------------------------------------
// Files

async function isFile(p: string): Promise<boolean> {
  try {
    return (await stat(p)).isFile();
  } catch {
    return false;
  }
}

async function isDir(p: string): Promise<boolean> {
  try {
    return (await stat(p)).isDirectory();
  } catch {
    return false;
  }
}

function inside(root: string, p: string): boolean {
  const rel = relative(root, p);
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel));
}

/**
 * Resolves a path written in `source` (relative to that file), checks it stays inside `root`
 * and exists. Returns the absolute path, or pushes an error positioned on the path's value.
 */
async function resolveRef(
  source: YamlSource,
  dataPath: PathSegment[],
  rel: string,
  root: string,
  errors: LevelError[],
): Promise<string | undefined> {
  const abs = resolve(dirname(source.file), rel);
  const pos = positionOf(source, dataPath);
  const err = (message: string) => errors.push({ file: source.file, line: pos.line, col: pos.col, path: formatPath(dataPath), message });
  if (!inside(root, abs)) {
    err(`${rel} points outside the levels directory`);
    return undefined;
  }
  if (!(await isFile(abs))) {
    err(`file not found: ${rel}`);
    return undefined;
  }
  return abs;
}

// ---------------------------------------------------------------------------------------------
// Level

export interface LoadLevelOptions {
  /** The chapter id the level must declare; when unknown (broken chapter.yaml) the id/chapter checks are relaxed. */
  chapterId?: string;
  /** Referenced files must resolve inside this directory. Defaults to the parent of the chapter directory. */
  root?: string;
}

/** Loads one level file. `level` is set only when the file has no errors at all. */
export async function loadLevel(file: string, opts: LoadLevelOptions = {}): Promise<{ level?: LoadedLevel; errors: LevelError[] }> {
  file = resolve(file);
  const dir = dirname(file);
  const root = opts.root ? resolve(opts.root) : dirname(dir);
  const errors: LevelError[] = [];

  let text: string;
  try {
    text = await readFile(file, 'utf8');
  } catch (e) {
    return { errors: [fileError(file, `cannot read file: ${(e as Error).message}`)] };
  }
  const parsed = parseYaml(file, text);
  if (parsed.errors.length) return { errors: parsed.errors };
  const { source } = parsed;
  const data = parsed.data;

  errors.push(...yamlTemplateErrors(source));

  // Inline `{ file: ./x.md }` markdown before schema validation, so the schema only ever sees text.
  const sources: Partial<Record<MarkdownField, string>> = {};
  if (data !== null && typeof data === 'object' && !Array.isArray(data)) {
    const rec = data as Record<string, unknown>;
    for (const field of MARKDOWN_FIELDS) {
      const v = rec[field];
      if (v === null || typeof v !== 'object' || Array.isArray(v)) continue;
      const keys = Object.keys(v);
      const ref = (v as Record<string, unknown>).file;
      // A placeholder keeps the schema from also reporting "required" for a field we already reported.
      rec[field] = '(unreadable markdown)';
      if (keys.length !== 1 || typeof ref !== 'string') {
        const pos = positionOf(source, [field]);
        errors.push({ file, line: pos.line, col: pos.col, path: field, message: `must be markdown text or { file: ./<name>.md }` });
        continue;
      }
      if (extname(ref) !== '.md') {
        const pos = positionOf(source, [field, 'file']);
        errors.push({ file, line: pos.line, col: pos.col, path: `${field}.file`, message: 'markdown files must end in .md' });
        continue;
      }
      const abs = await resolveRef(source, [field, 'file'], ref, root, errors);
      if (!abs) continue;
      const md = await readFile(abs, 'utf8');
      rec[field] = md;
      sources[field] = abs;
      errors.push(...textTemplateErrors(abs, md, field));
    }
  }

  const result = levelFileSchema.safeParse(data);
  if (!result.success) {
    errors.push(...zodErrors(result.error, source, data));
    return { errors: dedupe(errors) };
  }
  const level = result.data;

  // id = <chapter>-<file name>, and chapter = the enclosing chapter's id.
  const m = LEVEL_FILE_NAME.exec(basename(file));
  const stem = m ? `${m[1]}-${m[2]}` : basename(file, '.yaml');
  const at = (p: PathSegment[], message: string) => {
    const pos = positionOf(source, p);
    errors.push({ file, line: pos.line, col: pos.col, path: formatPath(p), message });
  };
  if (opts.chapterId !== undefined) {
    const expected = `${opts.chapterId}-${stem}`;
    if (level.id !== expected) at(['id'], `id must be ${expected} (chapter id + file name), found ${level.id}`);
    if (level.chapter !== opts.chapterId) at(['chapter'], `chapter must be ${opts.chapterId} (from chapter.yaml), found ${level.chapter}`);
  } else if (!level.id.endsWith(`-${stem}`)) {
    at(['id'], `id must end with -${stem} (the file name)`);
  }

  // Referenced files.
  if (level.mode !== 'decision' && level.solutions) {
    const solutions = level.solutions;
    const refs: { rel: string; path: PathSegment[] }[] = [
      { rel: solutions.reference, path: ['solutions', 'reference'] },
      ...solutions.wrong.map((w, i) => ({ rel: w.path, path: ['solutions', 'wrong', i, 'path'] as PathSegment[] })),
    ];
    for (const r of refs) {
      const abs = await resolveRef(source, r.path, r.rel, root, errors);
      // .redis scripts are rendered with the same variables before CI replays them.
      if (abs && abs.endsWith('.redis')) errors.push(...textTemplateErrors(abs, await readFile(abs, 'utf8'), formatPath(r.path)));
    }
  }
  for (const [i, step] of (level.setup ?? []).entries()) {
    if ('script' in step) await resolveRef(source, ['setup', i, 'script'], step.script, root, errors);
  }
  for (const [i, v] of level.verify.entries()) {
    if (v.type !== 'behavior' && !(v.type === 'antipattern' && 'fixtures' in v)) continue;
    const abs = await resolveRef(source, ['verify', i, 'fixtures'], v.fixtures, root, errors);
    if (abs) errors.push(...(await validateFixtureFile(abs, root, source, ['verify', i, 'fixtures'])));
  }

  if (errors.length) return { errors: dedupe(errors) };
  return { level: { level, file, dir, chapterId: level.chapter, sources }, errors: [] };
}

async function validateFixtureFile(abs: string, root: string, from: YamlSource, fromPath: PathSegment[]): Promise<LevelError[]> {
  if (extname(abs) !== '.yaml') {
    const pos = positionOf(from, fromPath);
    return [{ file: from.file, line: pos.line, col: pos.col, path: formatPath(fromPath), message: 'fixtures must be a .yaml file' }];
  }
  const parsed = parseYaml(abs, await readFile(abs, 'utf8'));
  if (parsed.errors.length) return parsed.errors;
  const errors = yamlTemplateErrors(parsed.source);
  const result = fixtureFileSchema.safeParse(parsed.data);
  if (!result.success) return [...errors, ...zodErrors(result.error, parsed.source, parsed.data)];
  for (const [i, step] of result.data.steps.entries()) {
    if ('script' in step) await resolveRef(parsed.source, ['steps', i, 'script'], step.script, root, errors);
  }
  return errors;
}

function dedupe(errors: LevelError[]): LevelError[] {
  const seen = new Set<string>();
  return errors.filter((e) => {
    const k = `${e.file}:${e.line}:${e.col}:${e.path}:${e.message}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

// ---------------------------------------------------------------------------------------------
// Chapter

/** Loads `<dir>/chapter.yaml` and every `NN-slug.yaml` level next to it. */
export async function loadChapter(dir: string): Promise<ChapterLoadResult> {
  dir = resolve(dir);
  const file = join(dir, CHAPTER_FILE);
  const dirName = basename(dir);
  const root = dirname(dir);
  const errors: LevelError[] = [];

  let chapter: Chapter | undefined;
  let source: YamlSource | undefined;
  let text: string | undefined;
  try {
    text = await readFile(file, 'utf8');
  } catch {
    errors.push(fileError(file, `missing ${CHAPTER_FILE}`));
  }
  if (text !== undefined) {
    const parsed = parseYaml(file, text);
    errors.push(...parsed.errors);
    if (!parsed.errors.length) {
      source = parsed.source;
      errors.push(...yamlTemplateErrors(parsed.source));
      const result = chapterSchema.safeParse(parsed.data);
      if (result.success) chapter = result.data;
      else errors.push(...zodErrors(result.error, parsed.source, parsed.data));
    }
  }

  const chapterAt = (p: PathSegment[], message: string) => {
    if (!source) return;
    const pos = positionOf(source, p);
    errors.push({ file, line: pos.line, col: pos.col, path: formatPath(p), message });
  };

  if (chapter) {
    const canonicalIndex = (CANONICAL_CHAPTER_DIRS as readonly string[]).indexOf(dirName);
    const canonicalId = canonicalIndex === -1 ? undefined : (dirName.split('-')[0] as string);
    if (canonicalId !== undefined && chapter.id !== canonicalId) {
      chapterAt(['id'], `the ${dirName} chapter has id ${canonicalId}`);
    } else if (dirName !== chapter.id && !dirName.startsWith(`${chapter.id}-`)) {
      chapterAt(['id'], `chapter id must be the directory name or its prefix before a dash (directory: ${dirName})`);
    }
  }

  // Level files.
  const entries = (await readdir(dir, { withFileTypes: true })).filter((e) => e.isFile()).map((e) => e.name).sort();
  const levelFiles: { name: string; nn: number; stem: string }[] = [];
  for (const name of entries) {
    if (name === CHAPTER_FILE) continue;
    if (name.endsWith('.yml')) {
      errors.push(fileError(join(dir, name), 'use the .yaml extension'));
      continue;
    }
    if (!name.endsWith('.yaml')) continue;
    const m = LEVEL_FILE_NAME.exec(name);
    if (!m) {
      errors.push(fileError(join(dir, name), 'level files are named NN-slug.yaml (two-digit number, kebab-case slug)'));
      continue;
    }
    levelFiles.push({ name, nn: Number(m[1]), stem: `${m[1]}-${m[2]}` });
  }

  const loaded = new Map<string, LoadedLevel>(); // expected id -> level
  const expectedIds = new Map<string, { name: string; nn: number }>();
  const seenNumbers = new Map<number, string>();
  for (const lf of levelFiles) {
    const abs = join(dir, lf.name);
    const prev = seenNumbers.get(lf.nn);
    if (prev) errors.push(fileError(abs, `level number ${lf.stem.slice(0, 2)} is already used by ${prev}`));
    seenNumbers.set(lf.nn, lf.name);
    const r = await loadLevel(abs, { chapterId: chapter?.id, root });
    errors.push(...r.errors);
    if (chapter) {
      const expected = `${chapter.id}-${lf.stem}`;
      expectedIds.set(expected, lf);
      if (r.level) loaded.set(expected, r.level);
    }
  }

  if (!chapter) return { errors: dedupe(errors) };

  // chapter.yaml `levels` is the manifest: every file listed once, in file-number order.
  let lastNumber = -1;
  chapter.levels.forEach((id, i) => {
    const lf = expectedIds.get(id);
    if (!lf) {
      chapterAt(['levels', i], `no level file for ${id} (expected ${id.slice(chapter.id.length + 1)}.yaml in this directory)`);
      return;
    }
    if (lf.nn <= lastNumber) chapterAt(['levels', i], `levels must be listed in file-number order (${id} is out of order)`);
    lastNumber = Math.max(lastNumber, lf.nn);
  });
  for (const [id, lf] of expectedIds) {
    if (!chapter.levels.includes(id)) errors.push(fileError(join(dir, lf.name), `${id} is not listed in ${CHAPTER_FILE} levels`, 'id'));
  }

  const levels = chapter.levels.map((id) => loaded.get(id)).filter((l): l is LoadedLevel => l !== undefined);
  return { chapter: { chapter, id: chapter.id, dir, dirName, file, levels }, errors: dedupe(errors) };
}

// ---------------------------------------------------------------------------------------------
// Trees

/**
 * Finds chapter directories under `dir`: `dir` itself if it holds a chapter.yaml, otherwise every
 * descendant that does. Subdirectories starting with `_` or `.` are skipped (so `levels/_examples`
 * never leaks into the game), but a `_` directory passed in explicitly is searched.
 */
async function findChapterDirs(dir: string, errors: LevelError[]): Promise<string[]> {
  if (await isFile(join(dir, CHAPTER_FILE))) return [dir];
  const out: string[] = [];
  const entries = (await readdir(dir, { withFileTypes: true })).sort((a, b) => (a.name < b.name ? -1 : 1));
  for (const e of entries) {
    if (e.isDirectory()) {
      if (e.name.startsWith('_') || e.name.startsWith('.') || e.name === 'node_modules') continue;
      out.push(...(await findChapterDirs(join(dir, e.name), errors)));
    } else if (e.isFile() && (e.name.endsWith('.yaml') || e.name.endsWith('.yml'))) {
      errors.push(fileError(join(dir, e.name), `YAML file outside a chapter directory (no ${CHAPTER_FILE} next to it)`));
    }
  }
  return out;
}

export function chapterOrder(a: LoadedChapter, b: LoadedChapter): number {
  const rank = (c: LoadedChapter) => {
    const i = (CANONICAL_CHAPTER_DIRS as readonly string[]).indexOf(c.dirName);
    return i === -1 ? CANONICAL_CHAPTER_DIRS.length : i;
  };
  return rank(a) - rank(b) || (a.dir < b.dir ? -1 : a.dir > b.dir ? 1 : 0);
}

/** Loads every chapter under `root` (normally `levels/`). The engine should refuse to start if `errors` is non-empty. */
export async function loadAllLevels(root: string, opts: { skipInterviewCheck?: boolean } = {}): Promise<LevelsLoadResult> {
  root = resolve(root);
  if (!(await isDir(root))) return { chapters: [], errors: [fileError(root, 'directory not found')] };
  const errors: LevelError[] = [];
  const dirs = await findChapterDirs(root, errors);
  const chapters: LoadedChapter[] = [];
  for (const d of dirs) {
    const r = await loadChapter(d);
    errors.push(...r.errors);
    if (r.chapter) chapters.push(r.chapter);
  }
  errors.push(...duplicateChapterErrors(chapters));
  chapters.sort(chapterOrder);
  // A caller that merges several roots (the validator) runs this once over the union instead.
  if (!opts.skipInterviewCheck) errors.push(...(await interviewReferenceErrors(chapters)));
  return { chapters, errors: dedupe(errors).sort(compareErrors) };
}

/**
 * F-12: an interview level's `rebuild_of` must name a level in the same chapter (listed before it) or in an
 * earlier chapter, by the chapter order of `chapters`. Needs the whole tree, so it runs here and not in the
 * level schema. Validating one chapter on its own therefore cannot resolve a reference into another one:
 * pass both directories to the validator.
 *
 * E-04: the same rule for every `interview.pool[].rebuild_of`, plus: a pool entry must name a `code` level that
 * is not itself a pool level (a pool level has no checks to draw).
 */
export async function interviewReferenceErrors(chapters: readonly LoadedChapter[]): Promise<LevelError[]> {
  const position = new Map<string, { chapter: number; level: number; loaded: LoadedLevel }>();
  chapters.forEach((c, ci) => c.levels.forEach((l, li) => position.set(l.level.id, { chapter: ci, level: li, loaded: l })));
  const errors: LevelError[] = [];
  for (const [ci, c] of chapters.entries()) {
    for (const [li, l] of c.levels.entries()) {
      if (l.level.mode !== 'code' || !l.level.interview) continue;
      const iv = l.level.interview;
      const targets: { id: string; path: PathSegment[]; pool: boolean }[] = iv.pool
        ? iv.pool.map((e, i) => ({ id: e.rebuild_of, path: ['interview', 'pool', i, 'rebuild_of'], pool: true }))
        : iv.rebuild_of
          ? [{ id: iv.rebuild_of, path: ['interview', 'rebuild_of'], pool: false }]
          : [];
      let source: YamlSource | undefined;
      const where = async (path: PathSegment[]) => {
        if (source === undefined) {
          try {
            const parsed = parseYaml(l.file, await readFile(l.file, 'utf8'));
            if (!parsed.errors.length) source = parsed.source;
          } catch {
            // keep 1:1; the message still names the problem
          }
        }
        return source ? positionOf(source, path) : { line: 1, col: 1 };
      };
      for (const t of targets) {
        const target = t.id;
        const found = position.get(target);
        const field = t.pool ? 'pool[].rebuild_of' : 'rebuild_of';
        let message: string | undefined;
        if (!found) {
          message = `${target} is not a level that was loaded; ${field} must name an existing level in this chapter or an earlier one (when validating one chapter alone, pass the chapter holding it too)`;
        } else if (found.chapter > ci || (found.chapter === ci && found.level >= li)) {
          message = `${target} comes ${found.chapter === ci ? 'after this level in its chapter' : 'in a later chapter'}; ${field} must name a level in this chapter (listed before this one) or an earlier chapter`;
        } else if (t.pool) {
          const tl = found.loaded.level;
          if (tl.mode !== 'code') message = `${target} is a ${tl.mode} level; a pool entry must name a code level (the learner rebuilds it from a blank file)`;
          else if (tl.interview?.pool) message = `${target} is itself a pool level; a pool entry must name a level that has its own checks`;
        }
        if (!message) continue;
        const pos = await where(t.path);
        errors.push({ file: l.file, line: pos.line, col: pos.col, path: formatPath(t.path), message });
      }
    }
  }
  return errors;
}

function duplicateChapterErrors(chapters: LoadedChapter[]): LevelError[] {
  const seen = new Map<string, LoadedChapter>();
  const errors: LevelError[] = [];
  for (const c of chapters) {
    const prev = seen.get(c.id);
    if (prev) errors.push(fileError(c.file, `chapter id ${c.id} is already used by ${prev.file}`, 'id'));
    else seen.set(c.id, c);
  }
  return errors;
}

/** Validates one or more level trees or chapter directories. Returns every error, sorted; empty means valid. */
export async function validateLevels(dirs: string | readonly string[]): Promise<LevelError[]> {
  const list = typeof dirs === 'string' ? [dirs] : dirs;
  const errors: LevelError[] = [];
  const chapters: LoadedChapter[] = [];
  for (const d of list) {
    const r = await loadAllLevels(d, { skipInterviewCheck: true });
    errors.push(...r.errors);
    chapters.push(...r.chapters);
  }
  // The same chapter reached twice (overlapping arguments) is not a duplicate.
  const unique = [...new Map(chapters.map((c) => [c.dir, c])).values()];
  errors.push(...duplicateChapterErrors(unique));
  errors.push(...(await interviewReferenceErrors([...unique].sort(chapterOrder))));
  return dedupe(errors).sort(compareErrors);
}
