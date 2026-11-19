import { describe, expect, test } from 'vitest';
import {
  accept,
  assistFor,
  commandCandidates,
  cursorInfo,
  hintFor,
  moveSelection,
  splitWords,
  subcommandCandidates,
  syntaxAt,
  type Hint,
  type Syntax,
} from '../src/terminal/complete';
import { docsFromCliText, namesFromCliText, type CommandDoc } from '../src/terminal/docs';
import { REPLIES } from './terminal.fixtures';

const names = namesFromCliText(REPLIES.LIST as string);
const docs: Record<string, CommandDoc> = {};
for (const [k, v] of Object.entries(REPLIES))
  if (k !== 'LIST') Object.assign(docs, docsFromCliText(v));
const doc = (n: string) => docs[n.toLowerCase()];
const text = (s: Syntax) => s.segs.map((x) => x.text).join('');
const activeText = (s: Syntax) =>
  s.segs
    .filter((x) => x.state === 'active')
    .map((x) => x.text)
    .join('')
    .trim();
const hint = (line: string, cursor = line.length): Hint | null => hintFor(line, cursor, doc);

describe('the line', () => {
  test('words split on spaces and keep quotes together', () => {
    expect(splitWords('SET a "hello world" EX 5').map((w) => w.text)).toEqual([
      'SET',
      'a',
      '"hello world"',
      'EX',
      '5',
    ]);
    expect(splitWords('  GET   x ').map((w) => [w.text, w.start])).toEqual([
      ['GET', 2],
      ['x', 8],
    ]);
    expect(splitWords('')).toEqual([]);
  });

  test('the word under the cursor, at the end, in the middle, and a new word after a space', () => {
    expect(cursorInfo('ge', 2)).toMatchObject({ index: 0, prefix: 'ge', wordStart: 0, wordEnd: 2 });
    expect(cursorInfo('get', 2)).toMatchObject({
      index: 0,
      prefix: 'ge',
      wordStart: 0,
      wordEnd: 3,
    });
    expect(cursorInfo('get ', 4)).toMatchObject({ index: 1, prefix: '', wordStart: 4 });
    expect(cursorInfo('get ke', 6)).toMatchObject({ index: 1, prefix: 'ke', wordStart: 4 });
    expect(cursorInfo('', 0)).toMatchObject({ index: 0, prefix: '' });
  });
});

describe('command candidates come from the server list only', () => {
  test('prefix matches, exact first, then shorter, then alphabetical', () => {
    const c = commandCandidates('g', names, doc);
    expect(c.length).toBeGreaterThan(3);
    expect(c.every((x) => x.name.startsWith('g'))).toBe(true);
    const lens = c.map((x) => x.name.length);
    expect(lens).toEqual([...lens].sort((a, b) => a - b));
    expect(commandCandidates('get', names, doc)[0]?.name).toBe('get');
  });

  test('summary and group are the server docs, and are blank until the docs are loaded', () => {
    const withDocs = commandCandidates('get', names, doc)[0];
    expect(withDocs?.summary).toBe('Returns the string value of a key.');
    expect(withDocs?.group).toBe('string');
    const bare = commandCandidates('get', names, () => undefined)[0];
    expect(bare?.summary).toBe('');
  });

  test('module commands (vector sets, search) and internal names are never offered', () => {
    const all = commandCandidates('v', names, doc, 100).map((x) => x.name);
    expect(all).not.toContain('VADD');
    expect(
      commandCandidates('ft', names, doc, 100)
        .map((x) => x.name)
        .some((n) => /ft\./i.test(n)),
    ).toBe(false);
    expect(commandCandidates('_', names, doc, 100)).toEqual([]);
  });

  test('a command whose docs say group module is dropped once they arrive', () => {
    const fake = (n: string) =>
      n === 'get' ? ({ ...(docs.get as CommandDoc), group: 'module' } as CommandDoc) : undefined;
    expect(commandCandidates('get', names, fake).some((x) => x.name === 'get')).toBe(false);
  });

  test('a short prefix matches starts only, three characters or more also match inside the name', () => {
    expect(commandCandidates('e', names, doc, 100).every((x) => x.name.startsWith('e'))).toBe(true);
    expect(commandCandidates('hs', names, doc, 100).every((x) => x.name.startsWith('hs'))).toBe(
      true,
    );
    const inside = commandCandidates('ttl', names, doc, 100).map((x) => x.name);
    expect(inside).toContain('ttl');
    expect(inside).toContain('pttl'); // contains, listed after the starts-with match
    expect(inside.indexOf('ttl')).toBeLessThan(inside.indexOf('pttl'));
  });

  test('empty prefix offers nothing, and the limit is honoured', () => {
    expect(commandCandidates('', names, doc)).toEqual([]);
    expect(commandCandidates('s', names, doc, 3)).toHaveLength(3);
  });

  test('subcommands of CLIENT start with what is typed and carry their own summary', () => {
    const client = doc('client') as CommandDoc;
    const li = subcommandCandidates(client, 'li', names);
    expect(li.map((x) => x.word)).toEqual(['LIST']);
    expect(li[0]?.summary).toMatch(/connections/i);
    expect(subcommandCandidates(client, '', names).length).toBeGreaterThan(5);
  });

  test('accepting replaces the whole word under the cursor and adds a space', () => {
    expect(accept('ge', 2, { word: 'GET' })).toEqual({ line: 'GET ', cursor: 4 });
    expect(accept('ge key', 2, { word: 'GET' })).toEqual({ line: 'GET key', cursor: 4 });
    expect(accept('client li', 9, { word: 'LIST' })).toEqual({ line: 'client LIST ', cursor: 12 });
  });

  test('selection wraps like a menu', () => {
    expect(moveSelection(5, 0, -1)).toBe(4);
    expect(moveSelection(5, 4, 1)).toBe(0);
    expect(moveSelection(0, 0, 1)).toBe(0);
  });
});

describe('assistFor decides when the popup exists', () => {
  const base = { names, doc };
  test('typing the first word opens it; before names are known, or on an empty line, it does not', () => {
    expect(assistFor({ ...base, line: 'ge', cursor: 2 }).kind).toBe('commands');
    expect(assistFor({ ...base, line: '', cursor: 0 }).kind).toBe('none');
    expect(assistFor({ line: 'ge', cursor: 2, names: null, doc }).kind).toBe('none');
  });
  test('a word that is exactly one command and nothing else is left alone', () => {
    expect(assistFor({ ...base, line: 'dbsize', cursor: 6 }).kind).toBe('none');
  });
  test('Escape (dismissed) keeps it closed until the word changes', () => {
    expect(assistFor({ ...base, line: 'ge', cursor: 2, dismissed: 'ge' }).kind).toBe('none');
    expect(assistFor({ ...base, line: 'get', cursor: 3, dismissed: 'ge' }).kind).toBe('commands');
  });
  test('the second word of a container command completes subcommands, other commands do not', () => {
    const a = assistFor({ ...base, line: 'client ', cursor: 7 });
    expect(a.kind).toBe('subcommands');
    expect(assistFor({ ...base, line: 'client li', cursor: 9 })).toMatchObject({
      kind: 'subcommands',
      wordStart: 7,
    });
    expect(assistFor({ ...base, line: 'xinfo st', cursor: 8 }).kind).toBe('subcommands');
    expect(assistFor({ ...base, line: 'get ke', cursor: 6 }).kind).toBe('none');
    expect(assistFor({ ...base, line: 'get x y', cursor: 7 }).kind).toBe('none');
  });
});

describe('the syntax hint marks the argument at the cursor', () => {
  test('GET key: the key is next', () => {
    const h = hint('GET ') as Hint;
    expect(text(h.syntax)).toBe('GET key');
    expect(activeText(h.syntax)).toBe('key');
    expect(h.summary).toBe('Returns the string value of a key.');
    expect(h.complexity).toBe('O(1)');
    expect(h.since).toBe('1.0.0');
  });

  test('a command typed without a space already shows its syntax', () => {
    expect(text((hint('GET') as Hint).syntax)).toBe('GET key');
    expect(hint('NOTACOMMAND ')).toBeNull();
  });

  test('SET: key, then value, then the optional groups', () => {
    expect(activeText((hint('SET ') as Hint).syntax)).toBe('key');
    expect(activeText((hint('SET greeting ') as Hint).syntax)).toBe('value');
    const afterValue = (hint('SET greeting hi ') as Hint).syntax;
    expect(text(afterValue)).toContain('[NX | XX');
    expect(activeText(afterValue)).toContain('NX | XX');
  });

  test('a token that is typed moves the cursor to its value: SET k v EX', () => {
    const s = (hint('SET k v EX ') as Hint).syntax;
    expect(activeText(s)).toBe('EX seconds');
    const done = (hint('SET k v EX 10 ') as Hint).syntax;
    expect(done.segs.find((x) => x.text === 'EX')?.state).toBe('done');
    expect(done.extra).toBe(false);
  });

  test('tokens are matched case-insensitively', () => {
    expect(activeText((hint('set k v ex ') as Hint).syntax)).toBe('EX seconds');
  });

  test('with options still possible, the cursor points at what the command needs next', () => {
    expect(activeText((hint('ZADD board ') as Hint).syntax)).toBe('score member');
    expect(activeText((hint('XADD s ') as Hint).syntax)).toBe('* | id');
    expect(activeText((hint('XADD s MAXLEN ') as Hint).syntax)).toBe('threshold');
    // inside an optional block with nothing required left in it, the required argument after the block is next
    expect(activeText((hint('XADD s MAXLEN ~ 100 ') as Hint).syntax)).toBe('* | id');
  });

  test('ZADD and HSET: a repeating pair is shown as a pair, and extra pairs are not "extra"', () => {
    const z = (hint('ZADD board 10 asha ') as Hint).syntax;
    expect(text(z)).toContain('[score member ...]');
    expect(z.extra).toBe(false);
    const h = (hint('HSET h a 1 b 2 ') as Hint).syntax;
    expect(text(h)).toContain('[field value ...]');
    expect(h.extra).toBe(false);
  });

  test('XADD: an optional block that does not start with the typed word is skipped, not entered', () => {
    const s = (hint('XADD s * name asha ') as Hint).syntax;
    expect(s.extra).toBe(false);
    expect(s.segs.find((x) => x.text === 'MAXLEN')?.state).not.toBe('done');
  });

  test('SCAN: cursor first, then MATCH pattern', () => {
    expect(activeText((hint('SCAN ') as Hint).syntax)).toBe('cursor');
    expect(activeText((hint('SCAN 0 MATCH ') as Hint).syntax)).toMatch(/MATCH/);
  });

  test('words past the documented syntax are flagged, not hidden', () => {
    expect((hint('GET a b c ') as Hint).syntax.extra).toBe(true);
  });

  test('a container command asks for its subcommand, then shows the subcommand syntax', () => {
    const container = hint('CLIENT ') as Hint;
    expect(text(container.syntax)).toBe('CLIENT subcommand');
    expect(container.summary).toMatch(/container/i);
    const sub = hint('CLIENT UNBLOCK ') as Hint;
    expect(text(sub.syntax)).toContain('CLIENT UNBLOCK client-id');
    expect(activeText(sub.syntax)).toBe('client-id');
    expect(hint('CLIENT NOSUCH ')).toBeNull();
  });

  test('syntaxAt on a bare doc with no arguments is just the command', () => {
    const bare: CommandDoc = { name: 'ping', summary: '', arguments: [], subcommands: {} };
    expect(text(syntaxAt(bare, 'PING', []))).toBe('PING');
  });
});
