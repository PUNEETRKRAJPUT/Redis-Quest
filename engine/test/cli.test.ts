import { describe, expect, test } from 'vitest';
import { formatReply, quote, splitArgs } from '../src/cli.js';

describe('splitArgs (redis-cli rules)', () => {
  test('plain words', () => expect(splitArgs('SET a 1')).toEqual(['SET', 'a', '1']));
  test('extra whitespace', () => expect(splitArgs('  GET   a  ')).toEqual(['GET', 'a']));
  test('double quotes keep spaces and process escapes', () => {
    expect(splitArgs('SET k "hello world\\n"')).toEqual(['SET', 'k', 'hello world\n']);
    expect(splitArgs('SET k "\\x41\\"q\\""')).toEqual(['SET', 'k', 'A"q"']);
  });
  test("single quotes are literal except \\'", () => {
    expect(splitArgs("SET k 'a \\n b'")).toEqual(['SET', 'k', 'a \\n b']);
    expect(splitArgs("SET k 'it\\'s'")).toEqual(['SET', 'k', "it's"]);
  });
  test('empty string argument', () => expect(splitArgs('SET k ""')).toEqual(['SET', 'k', '']));
  test('unbalanced quotes and junk after a closing quote are errors', () => {
    expect(splitArgs('SET k "oops')).toBeNull();
    expect(splitArgs('SET k "a"b')).toBeNull();
  });
  test('empty line', () => expect(splitArgs('   ')).toEqual([]));
});

describe('formatReply (redis-cli on a terminal)', () => {
  test('integer', () => expect(formatReply(5)).toEqual({ text: '(integer) 5', type: 'integer' }));
  test('nil', () => expect(formatReply(null)).toEqual({ text: '(nil)', type: 'nil' }));
  test('bulk is quoted, status is raw', () => {
    expect(formatReply('hi "x"').text).toBe('"hi \\"x\\""');
    expect(formatReply(Buffer.from('OK'))).toEqual({ text: 'OK', type: 'status' });
  });
  test('array with indices', () => {
    expect(formatReply(['a', 'b']).text).toBe('1) "a"\n2) "b"');
    expect(formatReply([]).text).toBe('(empty array)');
  });
  test('indices are right-aligned for 10+ items', () => {
    const lines = formatReply(Array.from({ length: 10 }, (_, i) => String(i))).text.split('\n');
    expect(lines[0]).toBe(' 1) "0"');
    expect(lines[9]).toBe('10) "9"');
  });
  test('nested arrays line up', () => {
    expect(formatReply([['a', 'b'], 'c']).text).toBe('1) 1) "a"\n   2) "b"\n2) "c"');
  });
  test('error inside an array', () =>
    expect(formatReply([new Error('ERR boom')]).text).toBe('1) (error) ERR boom'));
});

describe('quote', () => {
  test('control characters and non-UTF-8 bytes', () => {
    expect(quote('a\tb\x01')).toBe('"a\\tb\\x01"');
    expect(quote(Buffer.from([0xff, 0x41]))).toBe('"\\xffA"');
  });
  test('UTF-8 text stays readable', () => expect(quote('नमस्ते')).toBe('"नमस्ते"'));
});
