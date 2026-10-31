import { mkdir, mkdtemp, readdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { listTree, readWorkspaceFile, WorkspaceError, writeWorkspaceFile } from '../src/workspace.js';

let base: string;
let root: string;
let outside: string;
beforeEach(async () => {
  base = await mkdtemp(join(tmpdir(), 'quest-ws-'));
  root = join(base, 'workspace');
  outside = join(base, 'outside');
  await mkdir(root);
  await mkdir(outside);
  await writeFile(join(outside, 'secret.json'), '{"s":1}');
});
afterEach(async () => {
  await rm(base, { recursive: true, force: true });
});

const code = async (p: Promise<unknown>) => {
  try {
    await p;
    return 'ok';
  } catch (e) {
    return e instanceof WorkspaceError ? e.code : `other:${(e as Error).message}`;
  }
};

describe('containment', () => {
  test('rejects .., absolute paths and empty segments', async () => {
    expect(await code(readWorkspaceFile(root, '../outside/secret.json'))).toBe('invalid_path');
    expect(await code(readWorkspaceFile(root, 'a/../../outside/secret.json'))).toBe('invalid_path');
    expect(await code(readWorkspaceFile(root, join(outside, 'secret.json')))).toBe('invalid_path');
    expect(await code(readWorkspaceFile(root, '/etc/passwd.json'))).toBe('invalid_path');
    expect(await code(readWorkspaceFile(root, 'a//b.js'))).toBe('invalid_path');
    expect(await code(readWorkspaceFile(root, ''))).toBe('invalid_path');
    expect(await code(readWorkspaceFile(root, undefined))).toBe('invalid_path');
  });

  test('rejects a symlinked file or directory that escapes', async () => {
    await symlink(join(outside, 'secret.json'), join(root, 'link.json'));
    await symlink(outside, join(root, 'dir'));
    expect(await code(readWorkspaceFile(root, 'link.json'))).toBe('path_escapes_workspace');
    expect(await code(readWorkspaceFile(root, 'dir/secret.json'))).toBe('path_escapes_workspace');
    expect(await code(writeWorkspaceFile(root, 'dir/new.json', '{}'))).toBe('path_escapes_workspace');
    expect(await readdir(outside)).toEqual(['secret.json']);
  });

  test('only the allowed extensions', async () => {
    for (const ok of ['a.js', 'a.mjs', 'a.md', 'a.redis', 'a.sh', 'a.yaml', 'a.json']) {
      expect(await code(writeWorkspaceFile(root, ok, 'x'))).toBe('ok');
    }
    expect(await code(writeWorkspaceFile(root, 'a.exe', 'x'))).toBe('extension_not_allowed');
    expect(await code(readWorkspaceFile(root, 'a.txt'))).toBe('extension_not_allowed');
  });
});

describe('read, write, tree', () => {
  test('write creates directories and replaces atomically', async () => {
    await writeWorkspaceFile(root, 'ch1/cache/getStats.js', 'export default 1;\n');
    await writeWorkspaceFile(root, 'ch1/cache/getStats.js', 'export default 2;\n');
    expect((await readWorkspaceFile(root, 'ch1/cache/getStats.js')).content).toBe('export default 2;\n');
    expect(await readdir(join(root, 'ch1/cache'))).toEqual(['getStats.js']);
    expect(await readFile(join(root, 'ch1/cache/getStats.js'), 'utf8')).toContain('2');
  });

  test('missing file is not_found', async () => {
    expect(await code(readWorkspaceFile(root, 'nope.js'))).toBe('not_found');
  });

  test('tree lists files and dirs, hides dotfiles and symlinks', async () => {
    await writeWorkspaceFile(root, 'a/b.js', 'x');
    await writeFile(join(root, '.hidden.js'), 'x');
    await writeFile(join(root, 'notes.txt'), 'x');
    await symlink(outside, join(root, 'dir'));
    const t = await listTree(root);
    expect(t.map((e) => e.path)).toEqual(['a', 'a/b.js', 'notes.txt']);
    expect(t.find((e) => e.path === 'notes.txt')?.editable).toBe(false);
    expect(t.find((e) => e.path === 'a/b.js')?.editable).toBe(true);
  });
});
