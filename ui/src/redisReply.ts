// Parses the redis-cli style text that POST /api/cli returns back into values, so show-me components can
// read real keys through the same endpoint the terminal uses. No second backend.

export type Reply =
  | { kind: 'int'; v: number }
  | { kind: 'str'; v: string }
  | { kind: 'status'; v: string }
  | { kind: 'nil' }
  | { kind: 'error'; v: string }
  | { kind: 'array'; v: Reply[] };

/** redis-cli escapes non-printable and non-ASCII bytes as \xHH; rebuild the bytes and decode UTF-8. */
export function unquote(s: string): string {
  const inner = s.length >= 2 && s.startsWith('"') && s.endsWith('"') ? s.slice(1, -1) : s;
  const bytes: number[] = [];
  const enc = new TextEncoder();
  for (let i = 0; i < inner.length; i++) {
    const c = inner[i] as string;
    if (c !== '\\') {
      bytes.push(...enc.encode(c));
      continue;
    }
    const e = inner[++i];
    if (e === 'x' && /^[0-9a-fA-F]{2}$/.test(inner.slice(i + 1, i + 3))) {
      bytes.push(parseInt(inner.slice(i + 1, i + 3), 16));
      i += 2;
    } else if (e === 'n') bytes.push(10);
    else if (e === 'r') bytes.push(13);
    else if (e === 't') bytes.push(9);
    else if (e === 'b') bytes.push(8);
    else if (e === 'a') bytes.push(7);
    else if (e !== undefined) bytes.push(...enc.encode(e));
  }
  return new TextDecoder().decode(Uint8Array.from(bytes));
}

export function quoteArg(a: string): string {
  return `"${a.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n').replace(/\r/g, '\\r')}"`;
}

export function toCommand(argv: string[]): string {
  return argv.map(quoteArg).join(' ');
}

function scalar(text: string): Reply {
  const t = text.trimEnd();
  if (t.startsWith('"')) return { kind: 'str', v: unquote(t) };
  const int = /^\(integer\) (-?\d+)$/.exec(t);
  if (int) return { kind: 'int', v: Number(int[1]) };
  if (t === '(nil)') return { kind: 'nil' };
  if (t === '(empty array)' || t === '(empty list or set)') return { kind: 'array', v: [] };
  if (t.startsWith('(error) ')) return { kind: 'error', v: t.slice(8) };
  const dbl = /^\((?:double|float)\) (.+)$/.exec(t);
  if (dbl) return { kind: 'str', v: dbl[1] as string };
  return { kind: 'status', v: t };
}

interface Token {
  /** Column of the index's first digit. */
  col: number;
  /** Column of its ")": engine output right-aligns indexes (" 9)", "10)"), so this is what lines up. */
  end: number;
  text: string | null; // null: the rest of the line starts another marker
}

function tokenize(line: string): Token[] {
  const out: Token[] = [];
  let off = 0;
  for (;;) {
    const m = /^( *)(\d+)\) /.exec(line.slice(off));
    if (!m) break;
    const col = off + (m[1] as string).length;
    const end = col + (m[2] as string).length;
    off += m[0].length;
    const rest = line.slice(off);
    out.push({ col, end, text: /^ *\d+\) /.test(rest) ? null : rest });
    if (/^ *\d+\) /.test(rest)) continue;
    break;
  }
  return out;
}

function parseLevel(tokens: Token[], pos: number, first: Token): [Reply, number] {
  const items: Reply[] = [];
  let p = pos;
  // Same level: the index starts in the same column (left-aligned) or its ")" does (right-aligned).
  while (
    p < tokens.length &&
    ((tokens[p] as Token).col === first.col || (tokens[p] as Token).end === first.end)
  ) {
    const t = tokens[p] as Token;
    p++;
    if (t.text !== null) items.push(scalar(t.text));
    else {
      const next = tokens[p];
      if (!next) break;
      const [sub, np] = parseLevel(tokens, p, next);
      items.push(sub);
      p = np;
    }
  }
  return [{ kind: 'array', v: items }, p];
}

export function parseReply(text: string): Reply {
  if (/^ *\d+\) /.test(text)) {
    const tokens = text.split('\n').flatMap(tokenize);
    const first = tokens[0];
    if (first) return parseLevel(tokens, 0, first)[0];
  }
  return scalar(text);
}

export function asString(r: Reply | null | undefined): string | null {
  if (!r) return null;
  if (r.kind === 'str' || r.kind === 'status') return r.v;
  if (r.kind === 'int') return String(r.v);
  return null;
}

export function asNumber(r: Reply | null | undefined): number | null {
  if (!r) return null;
  if (r.kind === 'int') return r.v;
  const s = asString(r);
  if (s === null || s.trim() === '') return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

export function asList(r: Reply | null | undefined): Reply[] {
  return r && r.kind === 'array' ? r.v : [];
}

export function asStrings(r: Reply | null | undefined): string[] {
  return asList(r).map((x) => asString(x) ?? '');
}

/** Flat [k, v, k, v] reply (HGETALL, stream entry fields) to pairs. */
export function asPairs(r: Reply | null | undefined): [string, string][] {
  const l = asStrings(r);
  const out: [string, string][] = [];
  for (let i = 0; i + 1 < l.length; i += 2) out.push([l[i] as string, l[i + 1] as string]);
  return out;
}
