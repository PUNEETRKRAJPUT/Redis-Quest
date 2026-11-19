import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { expect, test } from 'vitest';

const here = path.dirname(fileURLToPath(import.meta.url));
import {
  cmd,
  describeReply,
  ENGINE_REFUSAL,
  formatArg,
  formatCommand,
  isEngineKey,
  nextTtlTotal,
  parseSeconds,
  plainError,
  runCommand,
} from '../src/showme/commands';
import {
  cleanupCommands,
  PRACTICE_DEL,
  PRACTICE_KEYS,
  setupCommands,
} from '../src/showme/practice';
import { SHOW_ME_IDS } from '../src/showme';

// The engine's real parser, lifted from engine/src/cli.ts at test time (importing the module would drag in the
// engine's whole dependency graph): what the command string must survive.
function loadSplitArgs(): (line: string) => string[] | null {
  const src = readFileSync(path.join(here, '../../engine/src/cli.ts'), 'utf8');
  const start = src.indexOf('export function splitArgs');
  const end = src.indexOf("/** redis-cli's quoting");
  const js = ts.transpileModule(src.slice(start, end).replace('export ', ''), {
    compilerOptions: { target: ts.ScriptTarget.ES2022 },
  }).outputText;
  return new Function(`${js}\nreturn splitArgs;`)() as (line: string) => string[] | null;
}
const splitArgs = loadSplitArgs();

const NASTY = [
  'plain',
  'with space',
  'two  spaces',
  'say "hi"',
  "it's",
  'back\\slash',
  'line\nbreak',
  'tab\there',
  'carriage\rreturn',
  'unicode wörld ✓ 日本語 🏏',
  '',
  '\\x41 literal',
  'ends with backslash\\',
  '"leading quote',
  '\'single\' and "double"',
  'nul\u0000byte',
  '#hash',
  '$dollar',
];

test('formatCommand round-trips through the engine parser for every awkward value', () => {
  for (const v of NASTY) {
    for (const argv of [
      cmd.set('practice:k', v),
      cmd.hset('practice:h', 'f ield', v),
      cmd.lpush('practice:l', v),
      cmd.sadd('practice:s', v),
      cmd.zincrby('practice:z', -5, v),
    ]) {
      expect(splitArgs(formatCommand(argv))).toEqual(argv);
    }
  }
});

test('bare when safe, quoted when needed', () => {
  expect(formatArg('practice:string')).toBe('practice:string');
  expect(formatArg('hello world')).toBe('"hello world"');
  expect(formatArg('say "hi"')).toBe('"say \\"hi\\""');
  expect(formatArg('')).toBe('""');
  expect(formatArg('wörld ✓')).toBe('"wörld ✓"');
  expect(formatCommand(cmd.set('practice:string', 'a b'))).toBe('SET practice:string "a b"');
  expect(formatArg('a\nb')).toBe('"a\\nb"');
});

test('the six gestures build the commands the spec names', () => {
  expect(cmd.set('k', 'v')[0]).toBe('SET');
  expect(cmd.hset('k', 'f', 'v')).toEqual(['HSET', 'k', 'f', 'v']);
  expect([
    cmd.lpush('k', 'v')[0],
    cmd.rpush('k', 'v')[0],
    cmd.lpop('k')[0],
    cmd.rpop('k')[0],
  ]).toEqual(['LPUSH', 'RPUSH', 'LPOP', 'RPOP']);
  expect([cmd.sadd('k', 'm')[0], cmd.srem('k', 'm')[0]]).toEqual(['SADD', 'SREM']);
  expect(cmd.zincrby('k', -10, 'm')).toEqual(['ZINCRBY', 'k', '-10', 'm']);
  expect(cmd.expire('k', 60)).toEqual(['EXPIRE', 'k', '60']);
  expect(cmd.persist('k')).toEqual(['PERSIST', 'k']);
});

test('engine keys are refused before any request is made', async () => {
  expect(isEngineKey('game:player:p-1')).toBe(true);
  expect(isEngineKey('practice:game:x')).toBe(false);
  let calls = 0;
  const cli = async () => {
    calls++;
    return { reply: 'OK', type: 'status', ms: 1 };
  };
  const r = await runCommand(cmd.set('game:progress', 'x'), cli);
  expect(r.ok).toBe(false);
  expect(r.error).toBe(ENGINE_REFUSAL);
  expect(calls).toBe(0);
  expect(r.command).toBe('SET game:progress x');
});

test('runCommand sends the exact string, explains replies and turns errors into plain words', async () => {
  const sent: string[] = [];
  const ok = await runCommand(cmd.lpush('practice:l', 'a b'), async (c) => {
    sent.push(c);
    return { reply: '(integer) 3', type: 'integer', ms: 0.4 };
  });
  expect(sent).toEqual(['LPUSH practice:l "a b"']);
  expect(ok).toMatchObject({ ok: true, note: 'The list now holds 3 items.', error: null });

  const wrong = await runCommand(cmd.lpop('practice:s'), async () => ({
    reply: '(error) WRONGTYPE Operation against a key holding the wrong kind of value',
    type: 'error',
    ms: 0.2,
  }));
  expect(wrong.ok).toBe(false);
  expect(wrong.error).toContain('different kind of value');

  const down = await runCommand(cmd.persist('practice:x'), async () => {
    throw new Error('network');
  });
  expect(down.ok).toBe(false);
  expect(down.error).toContain('Could not reach the game engine');
});

test('reply notes and error wording', () => {
  expect(describeReply(['EXPIRE', 'k', '5'], '(integer) 0', 'integer')).toContain('does not exist');
  expect(describeReply(['LPOP', 'k'], '(nil)', 'nil')).toContain('empty');
  expect(describeReply(['SADD', 'k', 'm'], '(integer) 0', 'integer')).toContain('Already');
  expect(describeReply(['HSET', 'k', 'f', 'v'], '(integer) 1', 'integer')).toContain('new field');
  expect(plainError('ERR value is not a valid float')).toBe(
    'Redis could not read that as a number.',
  );
  expect(plainError('ERR something odd')).toBe('Redis said: ERR something odd');
});

test('parseSeconds and the TTL ring scale', () => {
  expect(parseSeconds('90')).toBe(90);
  expect(parseSeconds(' 7 ')).toBe(7);
  expect(parseSeconds('0')).toBeNull();
  expect(parseSeconds('-3')).toBeNull();
  expect(parseSeconds('1.5')).toBeNull();
  expect(parseSeconds('abc')).toBeNull();
  // first reading sets the scale; a normal countdown keeps it; a reset starts a new life
  expect(nextTtlTotal(null, null, { ttl: 90, at: 0 })).toBe(90);
  expect(nextTtlTotal(90, { ttl: 90, at: 0 }, { ttl: 86, at: 4000 })).toBe(90);
  expect(nextTtlTotal(90, { ttl: 86, at: 4000 }, { ttl: 3600, at: 8000 })).toBe(3600);
  expect(nextTtlTotal(3600, { ttl: 3600, at: 0 }, { ttl: 10, at: 4000 })).toBe(10);
});

test('the nets stay under practice:, and every setup command parses', () => {
  for (const k of Object.values(PRACTICE_KEYS)) if (k) expect(k.startsWith('practice:')).toBe(true);
  for (const k of PRACTICE_DEL) expect(k.startsWith('practice:')).toBe(true);
  expect(Object.keys(PRACTICE_KEYS).sort()).toEqual([...SHOW_ME_IDS].sort());
  for (const argv of [...setupCommands(1), ...cleanupCommands()]) {
    expect(splitArgs(formatCommand(argv))).toEqual(argv);
    // every key the setup writes sits under the prefix
    const name = argv[0] as string;
    if (name !== 'XGROUP' && name !== 'XREADGROUP' && name !== 'DEL') {
      const key = argv[1] as string;
      expect(key.startsWith('practice:')).toBe(true);
    }
  }
});
