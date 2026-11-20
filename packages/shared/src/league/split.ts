// A verbatim copy of `splitArgs` from engine/src/cli.ts (redis-cli's sdssplitargs). The shared package cannot import
// the engine, and the league scorer, the contributor script and the engine route must split an entry's lines the
// same way the in-browser terminal does. packages/shared/src/league/__tests__/split.test.ts pins the engine's own
// test cases; if the engine's version changes, change this one with it.

/** Splits a line the way redis-cli does (sdssplitargs): quotes, escapes, `\xHH`. Returns null on bad quoting. */
export function splitArgs(line: string): string[] | null {
  const out: string[] = [];
  let i = 0;
  const n = line.length;
  const isSpace = (c: string) =>
    c === ' ' || c === '\n' || c === '\r' || c === '\t' || c === '\0' || c === '\v' || c === '\f';
  const isHex = (c: string | undefined) => !!c && /[0-9a-fA-F]/.test(c);
  while (i < n) {
    while (i < n && isSpace(line[i] as string)) i++;
    if (i >= n) break;
    let cur = '';
    let inq = false;
    let insq = false;
    for (;;) {
      const c = line[i];
      if (inq) {
        if (c === undefined) return null; // unterminated quotes
        if (c === '\\' && line[i + 1] === 'x' && isHex(line[i + 2]) && isHex(line[i + 3])) {
          cur += String.fromCharCode(parseInt(line.slice(i + 2, i + 4), 16));
          i += 3;
        } else if (c === '\\' && i + 1 < n) {
          i++;
          const e = line[i] as string;
          cur +=
            e === 'n'
              ? '\n'
              : e === 'r'
                ? '\r'
                : e === 't'
                  ? '\t'
                  : e === 'b'
                    ? '\b'
                    : e === 'a'
                      ? '\x07'
                      : e;
        } else if (c === '"') {
          // closing quote must be followed by a space or the end
          if (i + 1 < n && !isSpace(line[i + 1] as string)) return null;
          i++;
          break;
        } else {
          cur += c;
        }
      } else if (insq) {
        if (c === undefined) return null;
        if (c === '\\' && line[i + 1] === "'") {
          i++;
          cur += "'";
        } else if (c === "'") {
          if (i + 1 < n && !isSpace(line[i + 1] as string)) return null;
          i++;
          break;
        } else {
          cur += c;
        }
      } else {
        if (c === undefined || isSpace(c)) break;
        if (c === '"') inq = true;
        else if (c === "'") insq = true;
        else cur += c;
      }
      i++;
    }
    out.push(cur);
  }
  return out;
}
