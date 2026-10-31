// YAML parsing that keeps positions, and the error type every level problem is reported as.

import { relative, isAbsolute } from 'node:path';
import { isMap, isScalar, isSeq, LineCounter, parseDocument, type Document } from 'yaml';

/** One problem in one file, reported as `file:line:col field.path: message`. */
export interface LevelError {
  /** Absolute path of the file the problem is in (a level, chapter.yaml, markdown, fixture or solution file). */
  file: string;
  /** 1-based. */
  line: number;
  /** 1-based. */
  col: number;
  /** `verify[0].checks[1]`, `(root)` for the whole file, `(yaml)` for syntax errors. */
  path: string;
  message: string;
}

export type PathSegment = string | number;

export function formatPath(path: readonly PathSegment[]): string {
  let s = '';
  for (const seg of path) {
    if (typeof seg === 'number') s += `[${seg}]`;
    else s += s ? `.${seg}` : seg;
  }
  return s || '(root)';
}

/**
 * Formats an error for humans and CI. `base` makes the file path relative (the CLI passes the
 * repo root so paths read `levels/ch1-keyspace/07-x.yaml`); files outside `base` stay absolute.
 */
export function formatLevelError(e: LevelError, base?: string): string {
  let file = e.file;
  if (base) {
    const rel = relative(base, e.file);
    if (rel && !rel.startsWith('..') && !isAbsolute(rel)) file = rel;
  }
  return `${file}:${e.line}:${e.col} ${e.path}: ${e.message}`;
}

export function compareErrors(a: LevelError, b: LevelError): number {
  return a.file < b.file ? -1 : a.file > b.file ? 1 : a.line - b.line || a.col - b.col || (a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
}

export interface YamlSource {
  file: string;
  text: string;
  doc: Document.Parsed;
  lineCounter: LineCounter;
}

export interface Position {
  line: number;
  col: number;
}

export function offsetToPosition(lc: LineCounter, offset: number): Position {
  const p = lc.linePos(offset);
  return { line: p.line, col: p.col };
}

/** Line and column of an offset in plain text (used for markdown and .redis files). */
export function textPosition(text: string, offset: number): Position {
  let line = 1;
  let lineStart = 0;
  for (let i = 0; i < offset && i < text.length; i++) {
    if (text[i] === '\n') {
      line++;
      lineStart = i + 1;
    }
  }
  return { line, col: offset - lineStart + 1 };
}

export function parseYaml(file: string, text: string): { source: YamlSource; data: unknown; errors: LevelError[] } {
  const lineCounter = new LineCounter();
  const doc = parseDocument(text, { lineCounter, uniqueKeys: true, prettyErrors: false, logLevel: 'error' });
  const source: YamlSource = { file, text, doc, lineCounter };
  const errors: LevelError[] = [...doc.errors, ...doc.warnings].map((e) => {
    const pos = e.linePos?.[0] ?? offsetToPosition(lineCounter, e.pos[0]);
    return { file, line: pos.line, col: pos.col, path: '(yaml)', message: e.message.split('\n')[0] ?? e.message };
  });
  const data = errors.length ? undefined : doc.toJS({ maxAliasCount: 100 });
  return { source, data, errors };
}

interface Located {
  /** Offset of the node (or key) that best matches the path. */
  offset: number;
  /** True when the full path was found; false when we fell back to an ancestor. */
  exact: boolean;
}

/**
 * Finds the source offset for a data path. With `key: true` the last segment resolves to the
 * map key rather than its value, which is where an "unknown key" error belongs. When the path
 * does not exist (a missing required field) the nearest existing ancestor is returned.
 */
export function locate(source: YamlSource, path: readonly PathSegment[], opts: { key?: boolean } = {}): Located {
  let node: unknown = source.doc.contents;
  let offset = rangeStart(node) ?? 0;
  for (let i = 0; i < path.length; i++) {
    const seg = path[i];
    const last = i === path.length - 1;
    if (isMap(node)) {
      const pair = node.items.find((p) => isScalar(p.key) && String(p.key.value) === String(seg));
      if (!pair) return { offset, exact: false };
      const keyStart = rangeStart(pair.key);
      if (last && opts.key) return { offset: keyStart ?? offset, exact: true };
      node = pair.value;
      offset = rangeStart(node) ?? keyStart ?? offset;
    } else if (isSeq(node) && typeof seg === 'number') {
      const item: unknown = node.items[seg];
      if (item === undefined) return { offset, exact: false };
      node = item;
      offset = rangeStart(node) ?? offset;
    } else {
      return { offset, exact: false };
    }
  }
  return { offset, exact: true };
}

export function positionOf(source: YamlSource, path: readonly PathSegment[], opts: { key?: boolean } = {}): Position {
  return offsetToPosition(source.lineCounter, locate(source, path, opts).offset);
}

function rangeStart(node: unknown): number | undefined {
  if (node && typeof node === 'object' && 'range' in node) {
    const r = (node as { range?: [number, number, number] | null }).range;
    if (r) return r[0];
  }
  return undefined;
}

/** Walks every string scalar value (not keys) with its data path and source range. */
export function* stringScalars(
  source: YamlSource,
): Generator<{ value: string; path: PathSegment[]; range: [number, number] }> {
  function* walk(node: unknown, path: PathSegment[]): Generator<{ value: string; path: PathSegment[]; range: [number, number] }> {
    if (isMap(node)) {
      for (const pair of node.items) {
        if (isScalar(pair.key)) yield* walk(pair.value, [...path, String(pair.key.value)]);
      }
    } else if (isSeq(node)) {
      for (let i = 0; i < node.items.length; i++) yield* walk(node.items[i], [...path, i]);
    } else if (isScalar(node) && typeof node.value === 'string' && node.range) {
      yield { value: node.value, path, range: [node.range[0], node.range[1]] };
    }
  }
  yield* walk(source.doc.contents, []);
}

/** Reads the data value at a path (used to tell "missing" from "wrong type"). */
export function valueAt(data: unknown, path: readonly PathSegment[]): unknown {
  let cur: unknown = data;
  for (const seg of path) {
    if (cur === null || typeof cur !== 'object') return undefined;
    cur = (cur as Record<string, unknown>)[seg as string];
  }
  return cur;
}
