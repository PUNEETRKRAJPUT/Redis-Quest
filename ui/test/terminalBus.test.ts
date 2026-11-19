import { afterEach, describe, expect, test } from 'vitest';
import {
  onTerminalWanted,
  PENDING_MS,
  registerTerminal,
  resetBus,
  sendToTerminal,
  terminalIsLive,
} from '../src/terminal/bus';

afterEach(resetBus);

describe('send to terminal', () => {
  test('goes to the live terminal and is not copied', async () => {
    const got: string[] = [];
    const copied: string[] = [];
    registerTerminal((t) => got.push(t));
    expect(await sendToTerminal('GET a', { copy: async (t) => void copied.push(t) })).toBe(
      'terminal',
    );
    expect(got).toEqual(['GET a']);
    expect(copied).toEqual([]);
  });

  test('the most recently mounted terminal is the live one, and unmounting hands back to the previous', async () => {
    const a: string[] = [];
    const b: string[] = [];
    registerTerminal((t) => a.push(t));
    const offB = registerTerminal((t) => b.push(t));
    await sendToTerminal('1');
    offB();
    await sendToTerminal('2');
    expect(b).toEqual(['1']);
    expect(a).toEqual(['2']);
    expect(terminalIsLive()).toBe(true);
  });

  test('with no terminal it copies, and says so', async () => {
    const copied: string[] = [];
    expect(terminalIsLive()).toBe(false);
    expect(await sendToTerminal('PING', { copy: async (t) => void copied.push(t) })).toBe(
      'clipboard',
    );
    expect(copied).toEqual(['PING']);
  });

  test('a clipboard that refuses is reported, not thrown', async () => {
    expect(
      await sendToTerminal('PING', {
        copy: async () => {
          throw new Error('denied');
        },
      }),
    ).toBe('failed');
    expect(await sendToTerminal('PING', { copy: undefined })).toBe('failed');
  });

  test('a screen that can open a terminal is asked to, and the terminal takes the text when it mounts', async () => {
    let asked = 0;
    onTerminalWanted(() => asked++);
    expect(await sendToTerminal('SCAN 0', { now: () => 1000 })).toBe('queued');
    expect(asked).toBe(1);
    const got: string[] = [];
    registerTerminal(
      (t) => got.push(t),
      () => 1000 + PENDING_MS - 1,
    );
    expect(got).toEqual(['SCAN 0']);
    const later: string[] = [];
    registerTerminal((t) => later.push(t));
    expect(later).toEqual([]); // delivered once only
  });

  test('queued text that nobody collected in time is dropped, not delivered to a later terminal', async () => {
    onTerminalWanted(() => {});
    await sendToTerminal('INFO', { now: () => 0 });
    const got: string[] = [];
    registerTerminal(
      (t) => got.push(t),
      () => PENDING_MS + 1,
    );
    expect(got).toEqual([]);
  });
});
