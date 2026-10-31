import { hostPort, isRedisErrorReply, type RedisManager } from './redis.js';

/** Splits a line the way redis-cli does (sdssplitargs): quotes, escapes, `\xHH`. Returns null on bad quoting. */
export function splitArgs(line: string): string[] | null {
  const out: string[] = [];
  let i = 0;
  const n = line.length;
  const isSpace = (c: string) => c === ' ' || c === '\n' || c === '\r' || c === '\t' || c === '\0' || c === '\v' || c === '\f';
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
          cur += e === 'n' ? '\n' : e === 'r' ? '\r' : e === 't' ? '\t' : e === 'b' ? '\b' : e === 'a' ? '\x07' : e;
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

/** redis-cli's quoting of a bulk string. Works on the bytes (latin1) so binary values stay readable. */
export function quote(buf: Buffer | string): string {
  const s = typeof buf === 'string' ? Buffer.from(buf, 'utf8') : buf;
  // Valid UTF-8 text is kept as text; anything else is shown byte by byte like redis-cli does.
  let text: string | null = null;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(s);
  } catch {
    text = null;
  }
  let out = '"';
  if (text !== null) {
    for (const ch of text) {
      out += escapeChar(ch);
    }
  } else {
    for (const b of s) out += b >= 0x20 && b < 0x7f ? escapeChar(String.fromCharCode(b)) : `\\x${b.toString(16).padStart(2, '0')}`;
  }
  return `${out}"`;
}

function escapeChar(ch: string): string {
  switch (ch) {
    case '\\':
      return '\\\\';
    case '"':
      return '\\"';
    case '\n':
      return '\\n';
    case '\r':
      return '\\r';
    case '\t':
      return '\\t';
    case '\x07':
      return '\\a';
    case '\b':
      return '\\b';
  }
  const code = ch.codePointAt(0) as number;
  return code < 0x20 || code === 0x7f ? `\\x${code.toString(16).padStart(2, '0')}` : ch;
}

export type ReplyType = 'integer' | 'bulk' | 'status' | 'nil' | 'array' | 'error';

/** Formats a RESP2 reply as redis-cli does on a terminal. Simple strings must arrive as Buffer. */
export function formatReply(reply: unknown, indent = 0): { text: string; type: ReplyType } {
  if (reply === null || reply === undefined) return { text: '(nil)', type: 'nil' };
  if (typeof reply === 'number' || typeof reply === 'bigint') return { text: `(integer) ${reply}`, type: 'integer' };
  if (typeof reply === 'string') return { text: quote(reply), type: 'bulk' };
  if (reply instanceof Error) return { text: `(error) ${reply.message}`, type: 'error' };
  if (Buffer.isBuffer(reply)) return { text: reply.toString('utf8'), type: 'status' };
  if (Array.isArray(reply)) {
    if (reply.length === 0) return { text: '(empty array)', type: 'array' };
    const width = String(reply.length).length;
    const lines = reply.map((item, idx) => {
      const prefix = `${String(idx + 1).padStart(width, ' ')}) `;
      const inner = formatReply(item, indent + prefix.length).text;
      // continuation lines of a nested array line up under the first element
      return prefix + inner.split('\n').join(`\n${' '.repeat(prefix.length)}`);
    });
    return { text: lines.join('\n'), type: 'array' };
  }
  return { text: quote(String(reply)), type: 'bulk' };
}

export const DANGEROUS_COMMANDS: ReadonlySet<string> = new Set(['KEYS', 'FLUSHALL', 'FLUSHDB', 'MONITOR', 'DEBUG']);
/** After these the terminal connection is in a mode that would swallow later commands, so it is reset. */
const MODE_COMMANDS: ReadonlySet<string> = new Set(['MONITOR', 'SUBSCRIBE', 'PSUBSCRIBE', 'SSUBSCRIBE', 'SYNC', 'PSYNC']);

export interface CliResult {
  reply: string;
  type: ReplyType;
  ms: number;
  /** Not part of the HTTP body: the engine uses these to emit events. */
  command: string;
  argv: string[];
}

export async function runCli(redis: RedisManager, line: string): Promise<CliResult> {
  const started = performance.now();
  const done = (reply: string, type: ReplyType, argv: string[]): CliResult => ({
    reply,
    type,
    ms: Math.round((performance.now() - started) * 100) / 100,
    command: (argv[0] ?? '').toUpperCase(),
    argv,
  });
  const argv = splitArgs(line);
  if (argv === null) return done('Invalid argument(s)', 'error', []);
  if (argv.length === 0) return done('', 'status', []);
  const name = (argv[0] as string).toUpperCase();
  try {
    const raw = await redis.cliSend(argv);
    if (MODE_COMMANDS.has(name)) redis.resetCli();
    const f = formatReply(raw);
    return done(f.text, f.type, argv);
  } catch (err) {
    if (isRedisErrorReply(err)) return done(`(error) ${err.message}`, 'error', argv);
    const msg = err instanceof Error ? err.message : String(err);
    if (/no reply after/.test(msg)) return done(`(error) ${msg}; the terminal connection was reset`, 'error', argv);
    return done(`Could not connect to Redis at ${hostPort(redis.url)}: ${msg}`, 'error', argv);
  }
}
