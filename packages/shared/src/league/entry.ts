// An entry file: `golf/holes/<hole>/entries/<github-handle>.redis`. One command per line, `#` starts a comment line.
// Parsing is pure (text in, commands and positioned errors out), so the engine parses an attempt typed in the
// browser with the same code that CI uses for a file in a pull request.

import type { LevelError } from '../levels/source.js';
import { HANDLE } from './schema.js';
import { refusalFor } from './refuse.js';
import { splitArgs } from './split.js';

export const MAX_ENTRY_COMMANDS = 100;
export const MAX_ENTRY_BYTES = 16 * 1024;

export interface EntryCommand {
  /** 1-based line in the file. */
  line: number;
  /** The line as written, trimmed. */
  text: string;
  argv: string[];
}

export interface ParsedEntry {
  handle: string;
  commands: EntryCommand[];
  /** Length of the command lines (trimmed, joined with one newline); comments and blank lines do not count. */
  chars: number;
}

/** The handle in `<handle>.redis`, or null when the file name is not of that shape. */
export function handleFromFileName(name: string): string | null {
  if (!name.endsWith('.redis')) return null;
  const stem = name.slice(0, -'.redis'.length);
  return HANDLE.test(stem) ? stem : null;
}

export function parseEntry(
  handle: string,
  source: string,
  file: string = `${handle}.redis`,
): { entry?: ParsedEntry; errors: LevelError[] } {
  const errors: LevelError[] = [];
  const err = (line: number, col: number, message: string, path = '(root)') =>
    errors.push({ file, line, col, path, message });

  if (!HANDLE.test(handle)) {
    err(
      1,
      1,
      `'${handle}' is not a GitHub handle (letters, digits and single hyphens, at most 39 characters)`,
    );
  }
  if (Buffer.byteLength(source, 'utf8') > MAX_ENTRY_BYTES) {
    err(1, 1, `an entry is at most ${MAX_ENTRY_BYTES} bytes`);
    return { errors };
  }

  const commands: EntryCommand[] = [];
  const lines = (source.charCodeAt(0) === 0xfeff ? source.slice(1) : source).split(/\r?\n/);
  lines.forEach((raw, i) => {
    const line = i + 1;
    const trimmed = raw.trim();
    if (trimmed === '' || trimmed.startsWith('#')) return;
    const col = raw.length - raw.trimStart().length + 1;
    const argv = splitArgs(trimmed);
    if (argv === null) {
      err(
        line,
        col,
        'unbalanced quotes, or text right after a closing quote (the same rule redis-cli uses)',
      );
      return;
    }
    if (argv.length === 0) return;
    const why = refusalFor(argv);
    if (why) {
      err(line, col, why);
      return;
    }
    commands.push({ line, text: trimmed, argv });
  });

  if (commands.length === 0 && errors.length === 0) {
    err(1, 1, 'an entry needs at least one command (one command per line)');
  }
  if (commands.length > MAX_ENTRY_COMMANDS) {
    const extra = commands[MAX_ENTRY_COMMANDS] as EntryCommand;
    err(extra.line, 1, `an entry has at most ${MAX_ENTRY_COMMANDS} commands`);
  }
  if (errors.length > 0) return { errors };
  return {
    entry: { handle, commands, chars: commands.map((c) => c.text).join('\n').length },
    errors,
  };
}
