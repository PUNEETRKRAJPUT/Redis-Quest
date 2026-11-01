import type { CliReply } from '../types';

export const DANGEROUS: Record<string, string> = {
  KEYS: 'KEYS walks the whole keyspace in one go and blocks Redis while it does. Fine for debugging, never in app code. SCAN does the same job a little at a time.',
  FLUSHALL: 'FLUSHALL deletes every key in every database, including your save file mirror (game:*). The game can restore it, a real service cannot.',
  FLUSHDB: 'FLUSHDB deletes every key in this database, including your save file mirror (game:*). The game can restore it, a real service cannot.',
  MONITOR: 'MONITOR streams every command the server runs and slows it down. This terminal cannot stream it; use it only briefly, on a quiet box.',
  DEBUG: 'DEBUG is for Redis developers: some subcommands stall or crash the server.',
};

export function dangerNote(line: string): string | null {
  const first = line.trim().split(/\s+/)[0]?.toUpperCase() ?? '';
  return DANGEROUS[first] ?? null;
}

export const ESC = '\x1b[';
export const C = { dim: `${ESC}2m`, red: `${ESC}31m`, green: `${ESC}32m`, cyan: `${ESC}36m`, yellow: `${ESC}33m`, bold: `${ESC}1m`, off: `${ESC}0m` };

export function colourReply(r: CliReply): string {
  const body = r.reply.replace(/\r?\n/g, '\r\n');
  switch (r.type) {
    case 'error': return `${C.red}${body}${C.off}`;
    case 'integer': return `${C.cyan}${body}${C.off}`;
    case 'status': return `${C.green}${body}${C.off}`;
    case 'nil': return `${C.dim}${body}${C.off}`;
    default: return body;
  }
}
