import { lstat, mkdir, readdir, readFile, realpath, stat } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { writeFileAtomic } from './progress.js';

export const ALLOWED_EXTENSIONS = [
  '.js',
  '.mjs',
  '.md',
  '.redis',
  '.sh',
  '.yaml',
  '.json',
] as const;
export const MAX_FILE_BYTES = 1024 * 1024;

export class WorkspaceError extends Error {
  constructor(
    readonly code:
      | 'invalid_path'
      | 'path_escapes_workspace'
      | 'extension_not_allowed'
      | 'not_found'
      | 'too_large'
      | 'not_a_file',
    message: string,
  ) {
    super(message);
  }
}

export function hasAllowedExtension(p: string): boolean {
  const lower = p.toLowerCase();
  return ALLOWED_EXTENSIONS.some((e) => lower.endsWith(e));
}

/** Pure check on the text of a relative path, before touching the disk. */
export function validateRelative(rel: unknown): string {
  if (typeof rel !== 'string' || rel.length === 0)
    throw new WorkspaceError('invalid_path', 'path is required');
  if (rel.includes('\0')) throw new WorkspaceError('invalid_path', 'path contains a NUL byte');
  if (isAbsolute(rel) || rel.startsWith('/') || rel.startsWith('\\') || /^[a-zA-Z]:/.test(rel)) {
    throw new WorkspaceError('invalid_path', 'path must be relative to the workspace');
  }
  const parts = rel.split(/[\\/]/);
  if (parts.some((s) => s === '..'))
    throw new WorkspaceError('invalid_path', 'path may not contain ..');
  if (parts.some((s) => s === ''))
    throw new WorkspaceError('invalid_path', 'path has an empty segment');
  return parts.join('/');
}

function inside(root: string, p: string): boolean {
  const r = relative(root, p);
  return r === '' || (!r.startsWith('..') && !isAbsolute(r));
}

/**
 * Resolves `rel` inside `root`. Rejects `..`, absolute paths, and anything whose real location
 * (after following symlinks, on the file or on its nearest existing parent) is outside the root.
 */
export async function resolveInside(root: string, rel: unknown): Promise<string> {
  const clean = validateRelative(rel);
  const realRoot = await realpath(root);
  const target = resolve(realRoot, clean);
  if (!inside(realRoot, target))
    throw new WorkspaceError('invalid_path', 'path leaves the workspace');
  let probe = target;
  for (;;) {
    try {
      const real = await realpath(probe);
      if (!inside(realRoot, real))
        throw new WorkspaceError(
          'path_escapes_workspace',
          'a symlink in this path points outside the workspace',
        );
      return target;
    } catch (err) {
      if (err instanceof WorkspaceError) throw err;
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
      const parent = dirname(probe);
      if (parent === probe) return target;
      probe = parent;
    }
  }
}

export interface TreeEntry {
  path: string;
  type: 'file' | 'dir';
  size?: number;
  editable?: boolean;
}

const MAX_ENTRIES = 2000;
const MAX_DEPTH = 8;

export async function listTree(root: string): Promise<TreeEntry[]> {
  await mkdir(root, { recursive: true });
  const out: TreeEntry[] = [];
  async function walk(dir: string, prefix: string, depth: number): Promise<void> {
    if (depth > MAX_DEPTH || out.length >= MAX_ENTRIES) return;
    const names = (await readdir(dir)).sort();
    for (const name of names) {
      if (name.startsWith('.') || name === 'node_modules') continue;
      const abs = join(dir, name);
      const rel = prefix ? `${prefix}/${name}` : name;
      const st = await lstat(abs);
      if (st.isSymbolicLink()) continue; // never list or follow links
      if (st.isDirectory()) {
        out.push({ path: rel, type: 'dir' });
        await walk(abs, rel, depth + 1);
      } else if (st.isFile()) {
        out.push({ path: rel, type: 'file', size: st.size, editable: hasAllowedExtension(name) });
      }
      if (out.length >= MAX_ENTRIES) return;
    }
  }
  await walk(root, '', 0);
  return out;
}

export async function readWorkspaceFile(
  root: string,
  rel: unknown,
): Promise<{ path: string; content: string; size: number; mtime: string }> {
  const clean = validateRelative(rel);
  if (!hasAllowedExtension(clean))
    throw new WorkspaceError(
      'extension_not_allowed',
      `only ${ALLOWED_EXTENSIONS.join(' ')} files are available`,
    );
  const abs = await resolveInside(root, clean);
  let st;
  try {
    st = await stat(abs);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT')
      throw new WorkspaceError('not_found', `${clean} does not exist`);
    throw err;
  }
  if (!st.isFile()) throw new WorkspaceError('not_a_file', `${clean} is not a file`);
  if (st.size > MAX_FILE_BYTES)
    throw new WorkspaceError('too_large', `${clean} is larger than ${MAX_FILE_BYTES} bytes`);
  return {
    path: clean,
    content: await readFile(abs, 'utf8'),
    size: st.size,
    mtime: st.mtime.toISOString(),
  };
}

export async function writeWorkspaceFile(
  root: string,
  rel: unknown,
  content: unknown,
): Promise<{ path: string; size: number }> {
  const clean = validateRelative(rel);
  if (!hasAllowedExtension(clean))
    throw new WorkspaceError(
      'extension_not_allowed',
      `only ${ALLOWED_EXTENSIONS.join(' ')} files can be written`,
    );
  if (typeof content !== 'string')
    throw new WorkspaceError('invalid_path', 'content must be a string');
  const size = Buffer.byteLength(content, 'utf8');
  if (size > MAX_FILE_BYTES)
    throw new WorkspaceError('too_large', `content is larger than ${MAX_FILE_BYTES} bytes`);
  await mkdir(root, { recursive: true });
  const abs = await resolveInside(root, clean);
  await mkdir(dirname(abs), { recursive: true });
  // creating directories could not have escaped (nearest existing parent was checked), but re-check the file itself
  await resolveInside(root, clean);
  await writeFileAtomic(abs, content);
  return { path: clean, size };
}

export { sep };
