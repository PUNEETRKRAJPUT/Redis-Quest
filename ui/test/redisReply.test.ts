import { describe, expect, test } from 'vitest';
import {
  asNumber,
  asPairs,
  asString,
  asStrings,
  parseReply,
  quoteArg,
  toCommand,
  unquote,
} from '../src/redisReply';

describe('parseReply', () => {
  test('scalars', () => {
    expect(parseReply('(integer) 5')).toEqual({ kind: 'int', v: 5 });
    expect(parseReply('(integer) -2')).toEqual({ kind: 'int', v: -2 });
    expect(parseReply('(nil)')).toEqual({ kind: 'nil' });
    expect(parseReply('OK')).toEqual({ kind: 'status', v: 'OK' });
    expect(parseReply('"hello world"')).toEqual({ kind: 'str', v: 'hello world' });
    expect(parseReply('(error) ERR unknown command')).toEqual({
      kind: 'error',
      v: 'ERR unknown command',
    });
    expect(parseReply('(empty array)')).toEqual({ kind: 'array', v: [] });
  });

  test('flat array', () => {
    const r = parseReply('1) "name"\n2) "Asha"\n3) "xp"\n4) "45"');
    expect(asPairs(r)).toEqual([
      ['name', 'Asha'],
      ['xp', '45'],
    ]);
  });

  test('arrays with two-digit indexes keep their nesting aligned', () => {
    const lines = Array.from(
      { length: 11 },
      (_, i) =>
        `${String(i + 1)
          .padStart(2, ' ')
          .trimStart()}) "v${i + 1}"`,
    );
    expect(asStrings(parseReply(lines.join('\n')))).toHaveLength(11);
  });

  test('nested arrays (stream entry shape)', () => {
    const text = [
      '1) 1) "1730000002000-0"',
      '   2) 1) "over"',
      '      2) "17.4"',
      '2) 1) "1730000001000-0"',
      '   2) 1) "over"',
      '      2) "17.3"',
    ].join('\n');
    const r = parseReply(text);
    expect(r.kind).toBe('array');
    if (r.kind !== 'array') return;
    expect(r.v).toHaveLength(2);
    const first = r.v[0];
    expect(first?.kind).toBe('array');
    if (first?.kind !== 'array') return;
    expect(asString(first.v[0])).toBe('1730000002000-0');
    expect(asPairs(first.v[1])).toEqual([['over', '17.4']]);
  });

  test('nil inside an array', () => {
    const r = parseReply('1) 1) "73.86"\n   2) "18.52"\n2) (nil)');
    expect(r.kind).toBe('array');
    if (r.kind === 'array') expect(r.v[1]).toEqual({ kind: 'nil' });
  });
});

describe('unquote and quoting', () => {
  test('escapes', () => {
    expect(unquote('"a\\"b\\\\c\\nd"')).toBe('a"b\\c\nd');
    expect(unquote('"# Server\\r\\nredis_version:8"')).toBe('# Server\r\nredis_version:8');
  });
  test('\\xHH bytes are decoded as UTF-8', () => {
    expect(unquote('"\\xe0\\xa4\\xa8"')).toBe('न');
  });
  test('quoteArg round-trips through the engine splitter rules', () => {
    expect(quoteArg('a "b" \\')).toBe('"a \\"b\\" \\\\"');
    expect(toCommand(['GET', 'game:player:p-1'])).toBe('"GET" "game:player:p-1"');
  });
});

test('asNumber', () => {
  expect(asNumber(parseReply('(integer) 7'))).toBe(7);
  expect(asNumber(parseReply('"86400"'))).toBe(86400);
  expect(asNumber(parseReply('"abc"'))).toBeNull();
  expect(asNumber(parseReply('(nil)'))).toBeNull();
});
