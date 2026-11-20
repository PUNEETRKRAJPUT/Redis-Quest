import { describe, expect, test } from 'vitest';
import { handleFromFileName, MAX_ENTRY_COMMANDS, parseEntry } from '../entry.js';
import { refusalFor } from '../refuse.js';

describe('parseEntry', () => {
  test('commands, comments and blank lines', () => {
    const r = parseEntry('puneet', '# the house entry\n\nMSET a 1 b 2\n  GET a  \n');
    expect(r.errors).toEqual([]);
    expect(r.entry?.commands.map((c) => [c.line, c.argv])).toEqual([
      [3, ['MSET', 'a', '1', 'b', '2']],
      [4, ['GET', 'a']],
    ]);
    // trimmed command lines joined by one newline: comments and blank lines do not count
    expect(r.entry?.chars).toBe('MSET a 1 b 2\nGET a'.length);
  });

  test('quotes are split like redis-cli', () => {
    const r = parseEntry('puneet', 'SET k "two words"');
    expect(r.entry?.commands[0]?.argv).toEqual(['SET', 'k', 'two words']);
  });

  test('CRLF and a byte order mark are fine', () => {
    const r = parseEntry('puneet', '﻿SET a 1\r\nSET b 2\r\n');
    expect(r.errors).toEqual([]);
    expect(r.entry?.commands).toHaveLength(2);
  });

  test('a command inside a comment is not a command', () => {
    const r = parseEntry('puneet', '# EVAL "return 1" 0\nSET a 1');
    expect(r.errors).toEqual([]);
    expect(r.entry?.commands).toHaveLength(1);
  });

  test('unbalanced quotes give line and column', () => {
    const r = parseEntry('puneet', 'SET a 1\n  SET b "oops', '/golf/x/entries/puneet.redis');
    expect(r.entry).toBeUndefined();
    expect(r.errors).toHaveLength(1);
    expect(r.errors[0]).toMatchObject({ file: '/golf/x/entries/puneet.redis', line: 2, col: 3 });
  });

  test('refused commands are positioned and named, in any letter case', () => {
    const r = parseEntry('puneet', 'SET a 1\neval "return 1" 0');
    expect(r.errors).toHaveLength(1);
    expect(r.errors[0]).toMatchObject({ line: 2, col: 1 });
    expect(r.errors[0]?.message).toMatch(/^EVAL is not allowed/);
  });

  test('every command the spec names is refused', () => {
    for (const name of [
      'EVAL',
      'EVALSHA',
      'FCALL',
      'FUNCTION',
      'SCRIPT',
      'DEBUG',
      'FLUSHALL',
      'CONFIG',
    ]) {
      expect(refusalFor([name, 'x'])).toMatch(/is not allowed/);
    }
  });

  test('anything that could leave the scratch database is refused', () => {
    for (const argv of [
      ['SELECT', '0'],
      ['MOVE', 'k', '0'],
      ['SWAPDB', '0', '7'],
      ['FLUSHDB'],
      ['RESET'],
      ['COPY', 'a', 'b', 'DB', '0'],
    ]) {
      expect(refusalFor(argv), argv.join(' ')).not.toBeNull();
    }
    expect(refusalFor(['COPY', 'a', 'b'])).toBeNull();
    expect(refusalFor(['MSET', 'a', '1'])).toBeNull();
  });

  test('an empty entry and a too long entry are errors', () => {
    expect(parseEntry('puneet', '# nothing\n').errors[0]?.message).toMatch(/at least one command/);
    const many = Array.from({ length: MAX_ENTRY_COMMANDS + 1 }, (_, i) => `SET k${i} v`).join('\n');
    expect(parseEntry('puneet', many).errors[0]).toMatchObject({ line: MAX_ENTRY_COMMANDS + 1 });
  });

  test('a handle must look like a GitHub login', () => {
    expect(parseEntry('-bad', 'SET a 1').errors[0]?.message).toMatch(/not a GitHub handle/);
    expect(parseEntry('a--b', 'SET a 1').errors).not.toEqual([]);
    expect(parseEntry('a-b', 'SET a 1').errors).toEqual([]);
  });
});

describe('handleFromFileName', () => {
  test('the handle is the file name without .redis', () => {
    expect(handleFromFileName('puneet.redis')).toBe('puneet');
    expect(handleFromFileName('Octo-Cat.redis')).toBe('Octo-Cat');
    expect(handleFromFileName('puneet.txt')).toBeNull();
    expect(handleFromFileName('.redis')).toBeNull();
    expect(handleFromFileName('two words.redis')).toBeNull();
  });
});
