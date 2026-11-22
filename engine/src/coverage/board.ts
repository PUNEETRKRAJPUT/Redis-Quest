// The wanted-commands board (D-06): the server's own command list, grouped by the server's own group, each command
// marked taught or untaught. Pure; nothing about a command is written by hand. The scope cuts are the ones F-22
// made for the terminal (docs/handoffs/F-22.md): module commands (a dot in the name, upper case, a leading
// underscore, or `group: module` in the server's docs) are left out because this game teaches core Redis and
// teaches no vector or AI content. Subcommands (`client|list`) are not separate rows: the board is top-level.
import type { Snapshot } from '../command-docs.js';
import type { Reply } from '../verify/reply.js';
import type { Usage, UsedBy } from './usage.js';

export interface BoardCommand {
  name: string;
  /** The server's own one-line summary (`COMMAND DOCS`), empty when the server gave none. */
  summary: string;
  taught: boolean;
  /** Up to three levels that use it (a campaign level id or a community level id). */
  usedBy: UsedBy[];
}

export interface BoardGroup {
  group: string;
  total: number;
  taught: number;
  /** Untaught first, then taught; alphabetical inside each. */
  commands: BoardCommand[];
}

/** How the server's list divides: `listed` = `commands` + every `skipped` count. */
export interface Board {
  available: true;
  listed: number;
  commands: number;
  taught: number;
  untaught: number;
  skipped: { subcommands: number; modules: number };
  groups: BoardGroup[];
}

const MAX_USED_BY = 3;
const NO_GROUP = 'undocumented';

/** The value of `key` in a flat `[key, value, key, value, ...]` reply, or undefined. */
export function fieldOf(doc: Reply | undefined, key: string): Reply | undefined {
  if (!Array.isArray(doc)) return undefined;
  for (let i = 0; i + 1 < doc.length; i += 2) if (doc[i] === key) return doc[i + 1];
  return undefined;
}

/** Why a name is not on the board, or null when it is. */
export function skipReason(name: string, group: string | undefined): 'subcommand' | 'module' | null {
  if (name.includes('|')) return 'subcommand';
  if (name !== name.toLowerCase() || name.includes('.') || name.startsWith('_')) return 'module';
  if (group === 'module') return 'module';
  return null;
}

/** The lowercase top-level command names that are on the board: what a level's usage is matched against. */
export function boardNames(snap: Snapshot): Set<string> {
  const out = new Set<string>();
  for (const name of snap.names) {
    const group = fieldOf(snap.docs.get(name.toLowerCase())?.[1], 'group');
    if (skipReason(name, typeof group === 'string' ? group : undefined) === null) out.add(name);
  }
  return out;
}

export function buildBoard(snap: Snapshot, usage: Usage): Board {
  const byGroup = new Map<string, BoardCommand[]>();
  const skipped = { subcommands: 0, modules: 0 };
  let commands = 0;
  let taught = 0;
  for (const name of snap.names) {
    const doc = snap.docs.get(name.toLowerCase())?.[1];
    const g = fieldOf(doc, 'group');
    const group = typeof g === 'string' && g !== '' ? g : undefined;
    const reason = skipReason(name, group);
    if (reason === 'subcommand') skipped.subcommands++;
    else if (reason === 'module') skipped.modules++;
    if (reason !== null) continue;
    const s = fieldOf(doc, 'summary');
    const usedBy = usage.get(name) ?? [];
    const row: BoardCommand = {
      name,
      summary: typeof s === 'string' ? s : '',
      taught: usedBy.length > 0,
      usedBy: usedBy.slice(0, MAX_USED_BY),
    };
    commands++;
    if (row.taught) taught++;
    const key = group ?? NO_GROUP;
    byGroup.set(key, [...(byGroup.get(key) ?? []), row]);
  }
  const groups: BoardGroup[] = [...byGroup].map(([group, rows]) => ({
    group,
    total: rows.length,
    taught: rows.filter((r) => r.taught).length,
    commands: rows.sort(
      (a, b) => Number(a.taught) - Number(b.taught) || a.name.localeCompare(b.name),
    ),
  }));
  // The groups with the most still to write first.
  groups.sort((a, b) => b.total - b.taught - (a.total - a.taught) || a.group.localeCompare(b.group));
  return {
    available: true,
    listed: snap.names.length,
    commands,
    taught,
    untaught: commands - taught,
    skipped,
    groups,
  };
}
