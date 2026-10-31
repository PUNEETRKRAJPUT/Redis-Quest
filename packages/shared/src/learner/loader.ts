import { stat } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import type { LearnerFn } from './types.js';

export class LearnerModuleError extends Error {
  override name = 'LearnerModuleError';
}

export interface LoadedLearnerModule {
  fn: LearnerFn;
  /** The module namespace object (`default` plus any named exports). */
  exports: Record<string, unknown>;
}

/** Resolve `relPath` inside `workspaceDir`; throws if it escapes the directory. */
export function resolveWorkspacePath(workspaceDir: string, relPath: string): string {
  const root = path.resolve(workspaceDir);
  const abs = path.resolve(root, relPath);
  if (abs !== root && !abs.startsWith(root + path.sep)) {
    throw new LearnerModuleError(`module path escapes the workspace: ${relPath}`);
  }
  return abs;
}

/**
 * Import a learner module fresh. The URL gets `?v=<mtimeMs>-<size>`, so an edited file is re-evaluated
 * while an unchanged one is served from Node's cache. Limits: only the entry file is cache-busted
 * (relative helper imports are not), and old versions stay in memory for the life of the process, which
 * is why the runner uses a child process per run. `exportName` defaults to `default`.
 */
export async function loadLearnerModule(
  workspaceDir: string,
  relPath: string,
  exportName = 'default',
): Promise<LoadedLearnerModule> {
  const abs = resolveWorkspacePath(workspaceDir, relPath);
  let st;
  try {
    st = await stat(abs);
  } catch {
    throw new LearnerModuleError(`module not found: ${relPath}`);
  }
  if (!st.isFile()) throw new LearnerModuleError(`module is not a file: ${relPath}`);
  const url = `${pathToFileURL(abs).href}?v=${Math.trunc(st.mtimeMs)}-${st.size}`;
  const ns = (await import(/* @vite-ignore */ url)) as Record<string, unknown>;
  const fn = ns[exportName];
  if (typeof fn !== 'function') {
    throw new LearnerModuleError(
      exportName === 'default'
        ? `${relPath} has no default export function. Write: export default async function (deps, ...args) { ... }`
        : `${relPath} has no exported function named "${exportName}"`,
    );
  }
  return { fn: fn as LearnerFn, exports: ns };
}
