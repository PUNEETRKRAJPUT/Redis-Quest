import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, test } from 'vitest';
import { dangerCard, wrapText } from '../src/panels/terminalText';
import {
  CompletionPopup,
  KeyHints,
  optionId,
  SyntaxBar,
  type PopupView,
} from '../src/terminal/Assist';
import { hintFor, type Candidate } from '../src/terminal/complete';
import { docsFromCliText } from '../src/terminal/docs';
import { REPLIES } from './terminal.fixtures';

const docs = docsFromCliText(REPLIES.get as string);
// eslint-disable-next-line no-control-regex
const ANSI = /\x1b\[[0-9;]*m/g;

const item = (name: string, summary: string, group: string, matchLen = 2): Candidate => ({
  name,
  word: name.toUpperCase(),
  matchLen,
  summary,
  group,
  container: false,
});
const view = (over: Partial<PopupView> = {}): PopupView => ({
  kind: 'commands',
  items: [item('get', 'Returns the string value of a key.', 'string'), item('getex', '', '')],
  selected: 1,
  left: 12,
  width: 420,
  edge: 30,
  placement: 'above',
  ...over,
});

describe('completion popup markup', () => {
  test('a listbox of options with exactly one selected, the typed part emphasised', () => {
    const html = renderToStaticMarkup(<CompletionPopup view={view()} onPick={() => {}} />);
    expect(html).toContain('role="listbox"');
    expect(html.match(/role="option"/g)).toHaveLength(2);
    expect(html.match(/aria-selected="true"/g)).toHaveLength(1);
    expect(html).toContain(`id="${optionId(1)}"`);
    expect(html).toContain('<b>GE</b>T');
    expect(html).toContain('Returns the string value of a key.');
    expect(html).toContain('string');
  });
  test('it sits above or below the line as told, and never takes focus', () => {
    expect(renderToStaticMarkup(<CompletionPopup view={view()} onPick={() => {}} />)).toContain(
      'bottom:30px',
    );
    expect(
      renderToStaticMarkup(
        <CompletionPopup view={view({ placement: 'below' })} onPick={() => {}} />,
      ),
    ).toContain('top:30px');
    expect(renderToStaticMarkup(<CompletionPopup view={view()} onPick={() => {}} />)).not.toContain(
      'tabindex',
    );
  });
  test('rows without docs yet render, just without a summary', () => {
    const html = renderToStaticMarkup(<CompletionPopup view={view()} onPick={() => {}} />);
    expect(html).toContain('<b>GE</b>TEX');
  });
});

describe('syntax bar markup', () => {
  test('with a hint: the syntax with the cursor argument marked, the server summary, complexity and since', () => {
    const hint = hintFor('GET ', 4, (n) => docs[n]);
    const html = renderToStaticMarkup(<SyntaxBar hint={hint} docsReady />);
    expect(html).toContain('data-testid="terminal-syntax"');
    expect(html).toContain('data-active="true"');
    expect(html).toContain('Returns the string value of a key.');
    expect(html).toContain('O(1)');
    expect(html).toContain('since 1.0.0');
  });
  test('idle: the key hints, and no mention of Tab or Esc lists when there are no suggestions to accept', () => {
    const withDocs = renderToStaticMarkup(<SyntaxBar hint={null} docsReady />);
    expect(withDocs).toContain('complete');
    const without = renderToStaticMarkup(<KeyHints docsReady={false} />);
    expect(without).toContain('history');
    expect(without).not.toContain('complete');
    expect(without).not.toContain('close list');
  });
});

describe('the dangerous-command card', () => {
  test('keeps [warning] and the command in the first line and the whole note', () => {
    const note = 'KEYS walks the whole keyspace in one go and blocks Redis while it does.';
    const card = dangerCard('keys', note, 80);
    const plain = card.replace(ANSI, '');
    const lines = plain.split('\r\n');
    expect(lines.some((l) => l.includes('[warning] KEYS'))).toBe(true);
    expect(lines.join(' ').replace(/\s+/g, ' ')).toContain(note);
  });
  test('never wider than the terminal, and every row is the same width', () => {
    const rows = dangerCard('flushall', 'x '.repeat(200), 60).replace(ANSI, '').split('\r\n');
    expect(new Set(rows.map((r) => r.length)).size).toBe(1);
    expect(rows[0]?.length).toBeLessThanOrEqual(60);
  });
  test('wrapText breaks on words', () => {
    expect(wrapText('aaa bbb ccc', 7)).toEqual(['aaa bbb', 'ccc']);
    expect(wrapText('', 10)).toEqual([]);
  });
});
