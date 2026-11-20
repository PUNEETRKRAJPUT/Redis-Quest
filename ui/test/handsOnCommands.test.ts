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
  clampLonLat,
  isJsonText,
  mapToLonLat,
  nextTtlTotal,
  parseDayOffset,
  parseNumber,
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

test('the seven new gestures build the commands the spec names, in the documented argument order', () => {
  expect(cmd.xadd('k', [['over', '17.3']])).toEqual(['XADD', 'k', '*', 'over', '17.3']);
  expect(
    cmd.xadd('k', [
      ['over', '17.3'],
      ['runs', '4'],
    ]),
  ).toEqual(['XADD', 'k', '*', 'over', '17.3', 'runs', '4']);
  expect(cmd.jsonSet('k', '$.stats.runs', '600')).toEqual(['JSON.SET', 'k', '$.stats.runs', '600']);
  expect(cmd.jsonNumIncrBy('k', '$.stats.runs', 4)).toEqual([
    'JSON.NUMINCRBY',
    'k',
    '$.stats.runs',
    '4',
  ]);
  expect(cmd.jsonNumIncrBy('k', '$.a', -1.5)[3]).toBe('-1.5');
  expect(cmd.setbit('k', 11, 1)).toEqual(['SETBIT', 'k', '11', '1']);
  expect(cmd.setbit('k', 3, 0)).toEqual(['SETBIT', 'k', '3', '0']);
  expect(cmd.pfadd('k', 'visitor-9')).toEqual(['PFADD', 'k', 'visitor-9']);
  // longitude first, then latitude
  expect(cmd.geoadd('k', 73.86, 18.52, 'Gate 1')).toEqual([
    'GEOADD',
    'k',
    '73.86',
    '18.52',
    'Gate 1',
  ]);
  expect(cmd.bfAdd('k', 'asha')).toEqual(['BF.ADD', 'k', 'asha']);
  expect(cmd.bfExists('k', 'asha')).toEqual(['BF.EXISTS', 'k', 'asha']);
  expect(cmd.tsAdd('k', 31.5)).toEqual(['TS.ADD', 'k', '*', '31.5']);
});

test('the new commands round-trip through the engine parser for every awkward value', () => {
  for (const v of NASTY) {
    for (const argv of [
      cmd.xadd('practice:x', [
        ['f ield', v],
        [v, 'second'],
      ]),
      cmd.jsonSet('practice:j', '$.a b', v),
      cmd.pfadd('practice:p', v),
      cmd.geoadd('practice:g', -73.5, 18.25, v),
      cmd.bfAdd('practice:b', v),
      cmd.bfExists('practice:b', v),
    ]) {
      expect(splitArgs(formatCommand(argv))).toEqual(argv);
    }
  }
  // a JSON document with quotes and spaces survives as one argument
  const doc = JSON.stringify({ name: 'Asha "the wall"', tags: ['a b'] }, null, 1);
  expect(splitArgs(formatCommand(cmd.jsonSet('practice:json', '$', doc)))).toEqual([
    'JSON.SET',
    'practice:json',
    '$',
    doc,
  ]);
});

test('every new gesture refuses game: keys before any request', async () => {
  let calls = 0;
  const cli = async () => {
    calls++;
    return { reply: 'OK', type: 'status', ms: 1 };
  };
  for (const argv of [
    cmd.xadd('game:s', [['a', 'b']]),
    cmd.jsonSet('game:j', '$', '1'),
    cmd.jsonNumIncrBy('game:j', '$.n', 1),
    cmd.setbit('game:b', 0, 1),
    cmd.pfadd('game:h', 'x'),
    cmd.geoadd('game:g', 1, 2, 'm'),
    cmd.bfAdd('game:f', 'x'),
    cmd.bfExists('game:f', 'x'),
    cmd.tsAdd('game:t', 1),
  ]) {
    const r = await runCommand(argv, cli);
    expect(r.ok).toBe(false);
    expect(r.error).toBe(ENGINE_REFUSAL);
  }
  expect(calls).toBe(0);
});

test('reply notes for the new commands', () => {
  expect(describeReply(['XADD', 'k', '*', 'a', 'b'], '"1712-0"', 'string')).toContain('1712-0');
  expect(describeReply(['SETBIT', 'k', '1', '1'], '(integer) 0', 'integer')).toContain('was 0');
  expect(describeReply(['PFADD', 'k', 'x'], '(integer) 0', 'integer')).toContain('did not change');
  expect(describeReply(['GEOADD', 'k', '1', '2', 'm'], '(integer) 1', 'integer')).toContain(
    'new place',
  );
  expect(describeReply(['BF.EXISTS', 'k', 'x'], '(integer) 0', 'integer')).toContain(
    'Definitely not',
  );
  expect(describeReply(['BF.EXISTS', 'k', 'x'], '(integer) 1', 'integer')).toContain('may exist');
  expect(describeReply(['TS.ADD', 'k', '*', '1'], '(integer) 1712000000000', 'integer')).toContain(
    '1712000000000',
  );
  expect(describeReply(['JSON.NUMINCRBY', 'k', '$.n', '1'], '"[513]"', 'string')).toContain(
    '[513]',
  );
  expect(describeReply(['JSON.SET', 'k', '$', '1'], 'OK', 'status')).toBe('Saved at that path.');
});

test('parseNumber accepts only finite numbers', () => {
  expect(parseNumber('42')).toBe(42);
  expect(parseNumber(' -1.5 ')).toBe(-1.5);
  expect(parseNumber('2e3')).toBe(2000);
  expect(parseNumber('.5')).toBe(0.5);
  for (const bad of ['', ' ', 'abc', '1,5', 'NaN', 'Infinity', '0x10', '1e999', '--1'])
    expect(parseNumber(bad)).toBeNull();
});

test('a click on the map becomes a longitude and latitude the map would draw there', () => {
  const b = { minLon: 73.82, maxLon: 73.9, minLat: 18.5, maxLat: 18.56 };
  // the corners of the plotted area (pad 30 in a 360x220 box)
  expect(mapToLonLat(30, 190, b)).toEqual({ lon: 73.82, lat: 18.5 });
  expect(mapToLonLat(330, 30, b)).toEqual({ lon: 73.9, lat: 18.56 });
  // the centre is the middle of the box
  expect(mapToLonLat(180, 110, b)).toEqual({ lon: 73.86, lat: 18.53 });
  // one point: no scale, so a click is placed relative to the centre
  const one = { minLon: 73.86, maxLon: 73.86, minLat: 18.52, maxLat: 18.52 };
  expect(mapToLonLat(180, 110, one)).toEqual({ lon: 73.86, lat: 18.52 });
  expect(mapToLonLat(190, 100, one).lon).toBeGreaterThan(73.86);
  expect(mapToLonLat(190, 100, one).lat).toBeGreaterThan(18.52);
});

test('clampLonLat keeps a point inside what GEOADD accepts and rounds to 5 decimals', () => {
  expect(clampLonLat(200, 90)).toEqual({ lon: 180, lat: 85.05113 });
  expect(clampLonLat(-200, -90)).toEqual({ lon: -180, lat: -85.05113 });
  expect(clampLonLat(73.8612345678, 18.5)).toEqual({ lon: 73.86123, lat: 18.5 });
});

test('parseDayOffset reads a whole day inside the grid, blank meaning the next day', () => {
  expect(parseDayOffset('', 30, 11)).toBe(11);
  expect(parseDayOffset(' 4 ', 30, 11)).toBe(4);
  expect(parseDayOffset('', 30, 30)).toBeNull();
  expect(parseDayOffset('30', 30, 0)).toBeNull();
  expect(parseDayOffset('29', 30, 0)).toBe(29);
  for (const bad of ['-1', '1.5', 'x']) expect(parseDayOffset(bad, 30, 0)).toBeNull();
});

test('isJsonText wants a complete JSON value, so a bare word is not one', () => {
  for (const ok of ['600', '-1.5', '"Asha"', 'true', 'null', '[1, 2]', '{"a": {"b": 1}}', ' 7 '])
    expect(isJsonText(ok)).toBe(true);
  for (const bad of ['', '  ', 'Asha', "'x'", '{a: 1}', '[1,', '1 2'])
    expect(isJsonText(bad)).toBe(false);
});
