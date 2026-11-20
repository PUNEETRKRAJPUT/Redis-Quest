import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { Thread } from '../src/level/Thread';
import {
  applyPicks,
  chosenText,
  choicesKey,
  choicesOf,
  contentHash,
  needsChoice,
  readPicks,
  sanitizePicks,
  writePicks,
  type ChoiceMessage,
} from '../src/thread/logic';
import { ChoiceTray } from '../src/thread/parts';

const thread: ChoiceMessage[] = [
  { from: 'roommate', time: '19:24', text: 'bhai the app is not opening' },
  {
    from: 'you',
    time: '19:25',
    text: 'works on mine. what does it say',
    choices: [
      'works on mine. what does it say',
      'mere pe toh chal raha hai yaar. kya likha aa raha hai?',
      'ruk, mere pe chal raha hai. error ka text bhej',
    ],
  },
  { from: 'roommate', time: '19:27', text: 'ERR_CONNECTION_REFUSED' },
  { from: 'you', time: '19:28', text: 'which thing' },
];

function memory() {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => void data.set(k, v),
  };
}

describe('choices: pure helpers', () => {
  it('only the player has choices, and only when there are two or more real lines', () => {
    expect(choicesOf(thread[1])).toHaveLength(3);
    expect(choicesOf(thread[0])).toEqual([]);
    expect(choicesOf(thread[3])).toEqual([]);
    expect(choicesOf({ from: 'roommate', time: '1', text: 'x', choices: ['x', 'y'] })).toEqual([]);
    expect(choicesOf({ from: 'you', time: '1', text: 'x', choices: ['x'] })).toEqual([]);
    expect(choicesOf({ from: 'you', time: '1', text: 'x', choices: ['x', '  '] })).toEqual([]);
    expect(choicesOf(undefined)).toEqual([]);
  });
  it('an unpicked line says its own text, a pick says the chosen line', () => {
    const m = thread[1] as ChoiceMessage;
    expect(chosenText(m, undefined)).toBe(m.text);
    expect(chosenText(m, 0)).toBe(m.text);
    expect(chosenText(m, 2)).toBe('ruk, mere pe chal raha hai. error ka text bhej');
    expect(chosenText(m, 9)).toBe(m.text);
    expect(chosenText(thread[0] as ChoiceMessage, 1)).toBe('bhai the app is not opening');
  });
  it('applyPicks changes only the picked message and never the count or order', () => {
    const out = applyPicks(thread, { 1: 1 });
    expect(out).toHaveLength(thread.length);
    expect(out.map((m) => m.time)).toEqual(thread.map((m) => m.time));
    expect(out[1]?.text).toBe('mere pe toh chal raha hai yaar. kya likha aa raha hai?');
    expect(out[0]).toBe(thread[0]);
    expect(applyPicks(thread, {})).toEqual(thread);
  });
  it('the arrival waits only at a choice message that has not been picked', () => {
    expect(needsChoice(thread, 0, {})).toBe(false);
    expect(needsChoice(thread, 1, {})).toBe(true);
    expect(needsChoice(thread, 1, { 1: 0 })).toBe(false);
    expect(needsChoice(thread, 3, {})).toBe(false);
  });
  it('picks and the seen hash do not depend on each other: choices never change the content hash', () => {
    const plain = thread.map(({ from, time, text }) => ({ from, time, text }));
    expect(contentHash(thread)).toBe(contentHash(plain));
  });
});

describe('choices: remembered per thread in storage', () => {
  it('round-trips, and ignores picks that point nowhere', () => {
    const store = memory();
    const hash = contentHash(thread);
    writePicks(hash, { 1: 2 }, store);
    expect(store.data.get(choicesKey(hash))).toBe('{"1":2}');
    expect(readPicks(hash, thread, store)).toEqual({ 1: 2 });
    expect(sanitizePicks({ 1: 7, 3: 0, 99: 0, x: 1, 0: 0 }, thread)).toEqual({});
    expect(sanitizePicks({ 1: 'a' }, thread)).toEqual({});
    expect(sanitizePicks([1, 2], thread)).toEqual({});
    expect(sanitizePicks(null, thread)).toEqual({});
  });
  it('survives broken or missing storage', () => {
    const broken = {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('blocked');
      },
    };
    expect(readPicks('h', thread, broken)).toEqual({});
    expect(() => writePicks('h', { 1: 1 }, broken)).not.toThrow();
    expect(readPicks('h', thread, undefined)).toEqual({});
    const store = memory();
    store.setItem(choicesKey('h'), '{not json');
    expect(readPicks('h', thread, store)).toEqual({});
  });
});

describe('choices: markup', () => {
  it('the tray is a labelled group of buttons, one per line', () => {
    const html = renderToStaticMarkup(
      <ChoiceTray choices={choicesOf(thread[1])} onPick={() => undefined} reduced={false} />,
    );
    expect(html).toContain('role="group"');
    expect(html).toContain('aria-label="Pick your reply"');
    expect(html.match(/<button[^>]*data-testid="thread-choice"/g)).toHaveLength(3);
    expect(html).toContain('mere pe toh chal raha hai yaar');
  });
  it('a server-rendered thread shows every line in its own words and no tray (readable without JS)', () => {
    const html = renderToStaticMarkup(<Thread messages={thread} label="Boot incident thread" />);
    expect(html.match(/data-testid="thread-msg"/g)).toHaveLength(4);
    expect(html).toContain('works on mine. what does it say');
    expect(html).not.toContain('thread-choices');
    expect(html).not.toContain('mere pe toh chal raha hai');
  });
});
