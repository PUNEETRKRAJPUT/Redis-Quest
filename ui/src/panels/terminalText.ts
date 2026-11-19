import type { CliReply } from '../types';

export const DANGEROUS: Record<string, string> = {
  KEYS: 'KEYS walks the whole keyspace in one go and blocks Redis while it does. Fine for debugging, never in app code. SCAN does the same job a little at a time.',
  FLUSHALL:
    'FLUSHALL deletes every key in every database, including your save file mirror (game:*). The game can restore it, a real service cannot.',
  FLUSHDB:
    'FLUSHDB deletes every key in this database, including your save file mirror (game:*). The game can restore it, a real service cannot.',
  MONITOR:
    'MONITOR streams every command the server runs and slows it down. This terminal cannot stream it; use it only briefly, on a quiet box.',
  DEBUG: 'DEBUG is for Redis developers: some subcommands stall or crash the server.',
};

export function dangerNote(line: string): string | null {
  const first = line.trim().split(/\s+/)[0]?.toUpperCase() ?? '';
  return DANGEROUS[first] ?? null;
}

export const ESC = '\x1b[';
export const C = {
  dim: `${ESC}2m`,
  red: `${ESC}31m`,
  green: `${ESC}32m`,
  cyan: `${ESC}36m`,
  yellow: `${ESC}33m`,
  bold: `${ESC}1m`,
  off: `${ESC}0m`,
};

/** Night match colours as 24-bit escapes, for the parts of the transcript that are drawn rather than replied. */
export const T = {
  flood: `${ESC}38;2;255;179;71m`,
  chalk: `${ESC}38;2;238;242;250m`,
  dim: `${ESC}38;2;169;180;204m`,
  /** Background cells: the accent bar and the card surface (night-800). */
  barBg: `${ESC}48;2;255;154;31m`,
  cardBg: `${ESC}48;2;17;24;51m`,
};

export function wrapText(text: string, width: number): string[] {
  const lines: string[] = [];
  let line = '';
  for (const word of text.split(/\s+/).filter(Boolean)) {
    if (line && line.length + 1 + word.length > width) {
      lines.push(line);
      line = word;
    } else line = line ? `${line} ${word}` : word;
  }
  if (line) lines.push(line);
  return lines;
}

/**
 * The dangerous-command warning as a card in the transcript: an accent bar, a tinted surface, a bold title and the
 * note. Drawn with background colours rather than box-drawing characters, because the DOM renderer does not draw
 * those itself and a font's own versions leave gaps between rows. The word "[warning]" stays in the title line
 * (the e2e files look for it). `cols` is the terminal width; the card never exceeds it.
 */
export function dangerCard(command: string, note: string, cols: number): string {
  const width = Math.max(28, Math.min(96, cols - 2));
  const text = width - 4;
  const row = (content: string, style = T.chalk) =>
    `${T.barBg} ${C.off}${T.cardBg}  ${style}${content.padEnd(text)}${C.off}${T.cardBg}  ${C.off}`;
  return [
    row(''),
    row(`[warning] ${command.toUpperCase()}`, `${T.flood}${C.bold}`),
    ...wrapText(note, text).map((l) => row(l)),
    row(''),
  ].join('\r\n');
}

export function colourReply(r: CliReply): string {
  const body = r.reply.replace(/\r?\n/g, '\r\n');
  switch (r.type) {
    case 'error':
      return `${C.red}${body}${C.off}`;
    case 'integer':
      return `${C.cyan}${body}${C.off}`;
    case 'status':
      return `${C.green}${body}${C.off}`;
    case 'nil':
      return `${C.dim}${body}${C.off}`;
    default:
      return body;
  }
}
