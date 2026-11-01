// Startup cross-check of READ_ONLY_COMMANDS (written from memory in P0-05) against the live server's
// COMMAND INFO flags. Disagreements are logged as warnings; nothing is changed at run time.

import { READ_ONLY_COMMANDS } from '@quest/shared';
import { normalizeReply, type Reply } from './reply.js';
import type { SendCommand } from './types.js';

export interface CommandCheckReport {
  checkedAt: string;
  total: number;
  /** Allowlisted and flagged `readonly` by the server: full agreement. */
  readonlyFlagged: number;
  /** Allowlisted, flagged `write` by the server: a real disagreement. */
  write: string[];
  /** Allowlisted, unknown to the server (nil from COMMAND INFO). */
  unknown: string[];
  /** Allowlisted, neither `readonly` nor `write` (PING, INFO, TIME ...): no key access, harmless. */
  neither: Array<{ command: string; flags: string[] }>;
  /** Flagged `readonly` by the server but not allowlisted (informational: candidates to add). */
  readonlyNotListed: string[];
}

/** `CONFIG GET` -> `config|get`, the name COMMAND INFO uses for subcommands. */
export function commandInfoName(key: string): string {
  return key.toLowerCase().replace(' ', '|');
}

function flagsOf(entry: Reply): string[] | null {
  if (!Array.isArray(entry)) return null;
  const flags = entry[2];
  return Array.isArray(flags) ? flags.map((f) => String(f).toLowerCase()) : [];
}

/** Walks a COMMAND (no arguments) reply, including subcommands (element 9 since Redis 7). */
function readonlyNames(all: Reply): string[] {
  const out: string[] = [];
  const visit = (entry: Reply) => {
    if (!Array.isArray(entry) || typeof entry[0] !== 'string') return;
    const flags = flagsOf(entry) ?? [];
    if (flags.includes('readonly')) out.push(entry[0].toLowerCase());
    const subs = entry[9];
    if (Array.isArray(subs)) subs.forEach(visit);
  };
  if (Array.isArray(all)) all.forEach(visit);
  return out;
}

export async function crossCheckReadOnly(send: SendCommand): Promise<CommandCheckReport> {
  const keys = [...READ_ONLY_COMMANDS].sort();
  const names = keys.map(commandInfoName);
  const info = normalizeReply(await send(['COMMAND', 'INFO', ...names]));
  const report: CommandCheckReport = {
    checkedAt: new Date().toISOString(),
    total: keys.length,
    readonlyFlagged: 0,
    write: [],
    unknown: [],
    neither: [],
    readonlyNotListed: [],
  };
  keys.forEach((key, i) => {
    const flags = flagsOf(Array.isArray(info) ? (info[i] ?? null) : null);
    if (flags === null) report.unknown.push(key);
    else if (flags.includes('write')) report.write.push(key);
    else if (flags.includes('readonly')) report.readonlyFlagged += 1;
    else report.neither.push({ command: key, flags });
  });
  try {
    const listed = new Set(names);
    report.readonlyNotListed = readonlyNames(normalizeReply(await send(['COMMAND'])))
      .filter((n) => !listed.has(n))
      .sort();
  } catch {
    // informational only
  }
  return report;
}
