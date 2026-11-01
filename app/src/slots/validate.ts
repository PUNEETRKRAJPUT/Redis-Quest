import path from 'node:path';
import { SLOT_NAME } from '@quest/shared';
import type { SlotDef } from './types.js';

/** Registry mistakes are author mistakes: fail at boot (and in the unit test), never at request time. */
export function validateRegistry(defs: readonly SlotDef[]): string[] {
  const problems: string[] = [];
  const names = new Set<string>();
  const targets = new Set<string>();
  for (const d of defs) {
    if (!SLOT_NAME.test(d.name)) problems.push(`${d.name}: name must look like area.verbNoun`);
    if (names.has(d.name)) problems.push(`${d.name}: declared twice`);
    names.add(d.name);
    const norm = path.posix.normalize(d.file);
    if (path.posix.isAbsolute(d.file) || norm.startsWith('..') || norm !== d.file) {
      problems.push(`${d.name}: file must be a plain relative path inside the workspace (got ${d.file})`);
    }
    if (!/^ch[0-9][a-z0-9]*\/[a-z0-9][a-z0-9-]*\.m?js$/.test(d.file)) {
      problems.push(`${d.name}: file must look like chN/some-name.js (got ${d.file})`);
    }
    const target = `${d.file}#${d.exportName ?? 'default'}`;
    if (targets.has(target)) problems.push(`${d.name}: ${target} is already used by another slot`);
    targets.add(target);
    if (typeof d.baseline !== 'function') problems.push(`${d.name}: baseline must be a function`);
    if (!/^\(deps(, [a-zA-Z]+)*\)$/.test(d.signature)) problems.push(`${d.name}: signature must look like (deps, arg)`);
  }
  return problems;
}
