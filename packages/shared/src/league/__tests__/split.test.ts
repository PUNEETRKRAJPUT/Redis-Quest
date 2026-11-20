import { describe, expect, test } from 'vitest';
import { splitArgs } from '../split.js';

// The same cases engine/test/cli.test.ts holds for engine/src/cli.ts: the two copies must agree.
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
