// A `.redis` solution is one command per line, `#` comments, quoting like redis-cli. This is the same reading
// scripts/grade/grade.mjs does (trim, skip blanks and comments), plus the redis-cli quoting rules the engine's
// terminal uses, so a script means the same thing in the grader, the play-test and the loader.

/** Splits a line the way redis-cli does (quotes, backslash escapes, \xHH). Returns null on bad quoting. */
export function splitArgsLine(line: string): string[] | null {
  const out: string[] = [];
  let i = 0;
  const n = line.length;
  const isSpace = (c: string) => c === ' ' || c === '\t' || c === '\r' || c === '\n';
  while (i < n) {
    while (i < n && isSpace(line[i] as string)) i++;
    if (i >= n) break;
    let cur = '';
    let quote: '"' | "'" | null = null;
    for (;;) {
      const c = line[i];
      if (quote) {
        if (c === undefined) return null;
        if (c === '\\' && i + 1 < n) {
          i++;
          const e = line[i] as string;
          if (quote === '"') cur += e === 'n' ? '\n' : e === 't' ? '\t' : e === 'r' ? '\r' : e;
          else cur += e === "'" ? "'" : `\\${e}`;
        } else if (c === quote) {
          i++;
          if (i < n && !isSpace(line[i] as string)) return null;
          break;
        } else cur += c;
      } else {
        if (c === undefined || isSpace(c)) break;
        if (c === '"' || c === "'") quote = c;
        else cur += c;
      }
      i++;
    }
    out.push(cur);
  }
  return out;
}

/** The command lines of a script: trimmed, without blanks and `#` comments. Templates are left as written. */
export function scriptLines(text: string): string[] {
  return text
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l !== '' && !l.startsWith('#'));
}

/** Every command of a script as an argv list (lines with bad quoting are skipped; the engine reports them when it runs them). */
export function splitCommandLine(text: string): string[][] {
  return scriptLines(text)
    .map(splitArgsLine)
    .filter((a): a is string[] => a !== null && a.length > 0);
}
