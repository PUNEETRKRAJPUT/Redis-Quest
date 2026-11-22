// Reads the Redis commands out of a level's reference solution file, by pattern.
//
// It does not run or parse the code. Four shapes are recognised:
//   .redis  the first word of every line that is not a comment (CONFIG, XINFO and friends take their subcommand)
//   .js     node-redis calls on `redis` (and on a transaction made from it): `redis.hGetAll(` is HGETALL;
//           `sendCommand([...])`; and `redis.call('...')` inside the Lua scripts of a solution
//   .sh     `redis-cli <COMMAND>` lines, plus the commands sent as {"command":"..."} to the game's CLI route
// A command a solution uses without any of these shapes is not seen. The site says so.

import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

// Commands whose meaning depends on the first argument. Same idea as SUBCOMMAND_CONTAINERS in
// packages/shared/src/levels/commands.ts, plus two the solutions use (XGROUP, SENTINEL).
const CONTAINERS = new Set([
  'ACL',
  'CLIENT',
  'CLUSTER',
  'COMMAND',
  'CONFIG',
  'FUNCTION',
  'LATENCY',
  'MEMORY',
  'OBJECT',
  'PUBSUB',
  'SCRIPT',
  'SLOWLOG',
  'XINFO',
  'XGROUP',
  'SENTINEL',
]);

// node-redis method prefixes that are a container command plus a subcommand: memoryUsage, xInfoStream, ...
const METHOD_PREFIXES = [
  'acl',
  'client',
  'cluster',
  'command',
  'config',
  'function',
  'latency',
  'memory',
  'object',
  'pubsub',
  'script',
  'slowlog',
  'xInfo',
  'xGroup',
  'sentinel',
];

// node-redis module namespaces: redis.json.set(...) is JSON.SET.
const MODULES = {
  json: 'JSON',
  ts: 'TS',
  ft: 'FT',
  bf: 'BF',
  cf: 'CF',
  cms: 'CMS',
  topK: 'TOPK',
  tDigest: 'TDIGEST',
};

// Methods on the client that are not Redis commands.
const NOT_COMMANDS = new Set([
  'call',
  'pcall',
  'log',
  'duplicate',
  'sendCommand',
  'connect',
  'quit',
  'disconnect',
  'close',
  'destroy',
  'on',
  'once',
  'off',
  'emit',
  'isOpen',
  'isReady',
  'execAsPipeline',
  'withTypeMapping',
  'withCommandOptions',
]);

const NAME = /^[A-Z][A-Z0-9._]*(?: [A-Z0-9_-]+)?$/;

function nameFrom(first, second) {
  const name = first.toUpperCase();
  if (CONTAINERS.has(name) && second) return `${name} ${second.toUpperCase()}`;
  return name;
}

function methodToCommand(m) {
  // Lua's own API (register_function, error_reply, sha1hex ...) is not a Redis command.
  if (NOT_COMMANDS.has(m) || /Iterator$/.test(m) || m.includes('_') || /\d/.test(m)) return null;
  for (const p of METHOD_PREFIXES) {
    if (m.length > p.length && m.startsWith(p) && /[A-Z]/.test(m[p.length])) {
      return `${p.toUpperCase()} ${m.slice(p.length).toUpperCase()}`;
    }
  }
  const base = m.replace(/WithScores$/, '').replace(/^xPendingRange$/, 'xPending');
  return base.toUpperCase();
}

// ---------------------------------------------------------------------------------------------
// .redis

export function fromRedisFile(src) {
  const names = [];
  for (const raw of src.split('\n')) {
    const line = raw.trim();
    if (line === '' || line.startsWith('#')) continue;
    const [first, second] = line.split(/\s+/);
    if (!/^[A-Za-z][A-Za-z0-9._]*$/.test(first)) continue;
    names.push(nameFrom(first, second && /^[A-Za-z_-]+$/.test(second) ? second : undefined));
  }
  return names;
}

// ---------------------------------------------------------------------------------------------
// .js

function stripJsComments(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .split('\n')
    .map((l) => l.replace(/(^|[^:'"`\\])\/\/.*$/, '$1'))
    .join('\n');
}

/** Index just after the parenthesis that closes the one opening at `open`, or -1. Ignores strings: good enough here. */
function closeParen(code, open) {
  let depth = 0;
  for (let i = open; i < code.length; i++) {
    if (code[i] === '(') depth++;
    else if (code[i] === ')' && --depth === 0) return i + 1;
  }
  return -1;
}

export function fromJsFile(src) {
  const code = stripJsComments(src);
  const names = [];
  const add = (n) => {
    if (n) names.push(n);
  };

  // Lua inside a script string, and the generic escape hatch.
  for (const m of code.matchAll(
    /redis\.p?call\(\s*['"]([A-Za-z.]+)['"](?:\s*,\s*['"]([A-Za-z_-]+)['"])?/g,
  )) {
    add(nameFrom(m[1], m[2]));
  }
  for (const m of code.matchAll(
    /sendCommand\(\s*\[\s*['"]([A-Za-z.]+)['"](?:\s*,\s*['"]([A-Za-z_-]+)['"])?/g,
  )) {
    add(nameFrom(m[1], m[2]));
  }

  // redis.json.set(...)
  for (const m of code.matchAll(/\bredis\.(json|ts|ft|bf|cf|cms|topK|tDigest)\.([A-Za-z]\w*)\(/g)) {
    add(`${MODULES[m[1]]}.${m[2].toUpperCase()}`);
  }

  // A transaction kept in a variable: const tx = redis.multi();
  const multiVars = new Set();
  for (const m of code.matchAll(
    /\b(?:const|let|var)\s+(\w+)\s*=\s*(?:await\s+)?\w*[rR]edis\w*\.multi\(\)/g,
  )) {
    multiVars.add(m[1]);
  }
  const receivers = ['redis', 'redisCached', ...multiVars].join('|');
  const call = new RegExp(`\\b(${receivers})\\.([A-Za-z]\\w*)\\(`, 'g');
  for (const m of code.matchAll(call)) {
    add(methodToCommand(m[2]));
    const inTransaction = m[2] === 'multi' || multiVars.has(m[1]);
    if (!inTransaction) continue;
    // follow the chain: .multi().hSet(...).expire(...).exec()
    let at = closeParen(code, m.index + m[0].length - 1);
    while (at > -1) {
      const next = /^\s*\.\s*([A-Za-z]\w*)\(/.exec(code.slice(at));
      if (!next) break;
      add(methodToCommand(next[1]));
      at = closeParen(code, at + next[0].length - 1);
    }
  }
  return names;
}

// ---------------------------------------------------------------------------------------------
// .sh

export function fromShellFile(src) {
  const names = [];
  const lines = src.split('\n').filter((l) => !l.trim().startsWith('#'));
  const text = lines.join('\n');
  const direct =
    /redis-cli\b(?:\s+-\w+(?:\s+[^\s"'$-]\S*)?)*\s+["']?([A-Z][A-Za-z._]*)["']?(?:\s+["']?([A-Za-z_-]+)["']?)?/g;
  for (const m of text.matchAll(direct)) names.push(nameFrom(m[1], m[2]));
  // `ask() { docker compose exec -T sentinel-1 redis-cli -p 26379 "$@"; }` and then `ask SENTINEL replicas mymaster`
  if (/\bask\(\)\s*\{[^}]*redis-cli/.test(text)) {
    for (const m of text.matchAll(/^\s*ask\s+([A-Z][A-Za-z._]*)(?:\s+([A-Za-z_-]+))?/gm))
      names.push(nameFrom(m[1], m[2]));
  }
  // commands sent through the game's CLI route: -d '{"command":"SET score:final 31"}'
  for (const m of text.matchAll(/"command"\s*:\s*"([A-Za-z][A-Za-z._]*)(?:\s+([A-Za-z_-]+))?/g)) {
    names.push(nameFrom(m[1], m[2]));
  }
  return names;
}

// ---------------------------------------------------------------------------------------------

/**
 * @param loaded a LoadedLevel from @quest/shared (`level`, `dir`)
 * @returns {{kind:'commands', names:string[]} | {kind:'none', note:string}}
 */
export async function extractCommands(loaded) {
  const solutions = loaded.level.solutions;
  if (!solutions) {
    return {
      kind: 'none',
      note: 'a drawn mock interview: it uses the commands of the level it draws',
    };
  }
  if (loaded.level.mode === 'decision') {
    return { kind: 'none', note: 'a decision level: you choose, you do not type commands' };
  }
  const file = resolve(loaded.dir, solutions.reference);
  const src = await readFile(file, 'utf8');
  const raw = file.endsWith('.redis')
    ? fromRedisFile(src)
    : file.endsWith('.sh')
      ? fromShellFile(src)
      : fromJsFile(src);
  const names = [...new Set(raw)].filter((n) => NAME.test(n));
  if (names.length === 0) {
    return {
      kind: 'none',
      note: file.endsWith('.sh')
        ? 'an ops level: the reference is shell commands, no redis-cli line'
        : 'no command found by the pattern',
    };
  }
  return { kind: 'commands', names };
}
