import { describe, expect, it } from 'vitest';
import {
  GAP_MS,
  MAX_REVEAL_MS,
  TYPING_CAP_MS,
  avatarTone,
  contentHash,
  groupMessages,
  initials,
  participants,
  planReveal,
  readSeen,
  seenKey,
  shouldPlay,
  shouldPlayCue,
  startsGroup,
  toneIndex,
  typingDelay,
  writeSeen,
} from '../src/thread/logic';
import type { ThreadMessage } from '../src/types';

const m = (from: string, text: string, time = '19:00'): ThreadMessage => ({ from, time, text });

describe('groupMessages', () => {
  const msgs = [
    m('roommate', 'a'),
    m('roommate', 'b'),
    m('you', 'c'),
    m('roommate', 'd'),
    m('you', 'e'),
  ];
  it('groups consecutive messages by sender', () => {
    const g = groupMessages(msgs);
    expect(g.map((x) => [x.from, x.messages.length, x.start])).toEqual([
      ['roommate', 2, 0],
      ['you', 1, 2],
      ['roommate', 1, 3],
      ['you', 1, 4],
    ]);
  });
  it('handles empty input', () => expect(groupMessages([])).toEqual([]));
  it('startsGroup marks the first message of each run', () => {
    expect(msgs.map((_, i) => startsGroup(msgs, i))).toEqual([true, false, true, true, true]);
  });
  it('lists participants in order of first appearance', () => {
    expect(participants(msgs)).toEqual(['roommate', 'you']);
  });
});

describe('typingDelay', () => {
  it('grows with the length of the message', () => {
    expect(typingDelay('ok')).toBeLessThan(
      typingDelay('ok, and what happens to the data if I close it?'),
    );
  });
  it('never exceeds the cap', () => {
    expect(typingDelay('x'.repeat(5000))).toBe(TYPING_CAP_MS);
    expect(typingDelay('x'.repeat(5000), 300)).toBe(300);
  });
  it('is never negative or NaN for empty text', () => {
    expect(typingDelay('')).toBeGreaterThan(0);
  });
  it('counts emoji as one character each', () => {
    expect(typingDelay('\u{1F64F}\u{1F64F}')).toBe(typingDelay('ab'));
  });
});

describe('planReveal', () => {
  it('has one step per message', () => {
    const msgs = [m('senior', 'hello'), m('you', 'hi')];
    expect(planReveal(msgs).steps).toHaveLength(2);
  });
  it('keeps a short thread at natural speed', () => {
    const p = planReveal([m('senior', 'hello'), m('you', 'hi')]);
    expect(p.scale).toBe(1);
    expect(p.totalMs).toBeLessThan(MAX_REVEAL_MS);
  });
  it('caps the total however many messages there are', () => {
    for (const n of [12, 40, 200]) {
      const msgs = Array.from({ length: n }, (_, i) =>
        m(
          i % 2 ? 'you' : 'senior',
          'a fairly long line of chat text that takes a while to type out',
        ),
      );
      const p = planReveal(msgs);
      expect(p.totalMs).toBeLessThanOrEqual(MAX_REVEAL_MS + n); // rounding of up to 1 ms per step
      if (n >= 40) expect(p.scale).toBeLessThan(1);
    }
  });
  it('honours a custom cap', () => {
    const msgs = Array.from({ length: 10 }, (_, i) => m(i % 2 ? 'you' : 'senior', 'x'.repeat(80)));
    expect(planReveal(msgs, 2000).totalMs).toBeLessThanOrEqual(2010);
  });
  it('types faster for a burst from the same sender', () => {
    const text = 'x'.repeat(60);
    const p = planReveal([m('senior', text), m('senior', text), m('you', text)]);
    expect(p.steps[1]!.typingMs).toBeLessThan(p.steps[0]!.typingMs);
    expect(p.steps[2]!.gapMs).toBe(GAP_MS);
  });
  it('is empty for no messages', () => {
    expect(planReveal([])).toEqual({ steps: [], totalMs: 0, scale: 1 });
  });
});

describe('shouldPlayCue', () => {
  it('lets the first cue through and throttles bursts', () => {
    expect(shouldPlayCue(1000, null)).toBe(true);
    expect(shouldPlayCue(1050, 1000)).toBe(false);
    expect(shouldPlayCue(1200, 1000)).toBe(true);
  });
});

describe('contentHash', () => {
  const a = [m('roommate', 'hi'), m('you', 'yo')];
  it('is stable and 8 hex digits', () => {
    expect(contentHash(a)).toBe(contentHash([...a]));
    expect(contentHash(a)).toMatch(/^[0-9a-f]{8}$/);
  });
  it('changes with text, sender, time or order', () => {
    const base = contentHash(a);
    expect(contentHash([m('roommate', 'hi!'), m('you', 'yo')])).not.toBe(base);
    expect(contentHash([m('senior', 'hi'), m('you', 'yo')])).not.toBe(base);
    expect(contentHash([m('roommate', 'hi', '19:01'), m('you', 'yo')])).not.toBe(base);
    expect(contentHash([a[1]!, a[0]!])).not.toBe(base);
  });
  it('does not confuse where one field ends and the next begins', () => {
    expect(contentHash([m('ab', 'c')])).not.toBe(contentHash([m('a', 'bc')]));
  });
});

describe('seen storage', () => {
  const store = () => {
    const mem = new Map<string, string>();
    return {
      getItem: (k: string) => mem.get(k) ?? null,
      setItem: (k: string, v: string) => void mem.set(k, v),
      mem,
    };
  };
  it('round-trips per hash', () => {
    const s = store();
    expect(readSeen('abc', s)).toBe(false);
    writeSeen('abc', s);
    expect(readSeen('abc', s)).toBe(true);
    expect(readSeen('def', s)).toBe(false);
    expect(s.mem.has(seenKey('abc'))).toBe(true);
  });
  it('survives storage that throws or is missing', () => {
    const bad = {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('blocked');
      },
    };
    expect(readSeen('abc', bad)).toBe(false);
    expect(() => writeSeen('abc', bad)).not.toThrow();
    expect(readSeen('abc', undefined)).toBe(false);
    expect(() => writeSeen('abc', undefined)).not.toThrow();
  });
});

describe('shouldPlay', () => {
  const base = { mode: 'auto' as const, seen: false, reduced: false, count: 3 };
  it('plays on first view', () => expect(shouldPlay(base)).toBe(true));
  it('opens revealed once seen', () => expect(shouldPlay({ ...base, seen: true })).toBe(false));
  it('always ignores seen, never ignores everything', () => {
    expect(shouldPlay({ ...base, mode: 'always', seen: true })).toBe(true);
    expect(shouldPlay({ ...base, mode: 'never' })).toBe(false);
  });
  it('reduced motion shows everything at once', () => {
    expect(shouldPlay({ ...base, reduced: true })).toBe(false);
    expect(shouldPlay({ ...base, mode: 'always', reduced: true })).toBe(false);
  });
  it('has nothing to play for an empty thread', () =>
    expect(shouldPlay({ ...base, count: 0 })).toBe(false));
});

describe('avatars', () => {
  const cast = ['roommate', 'senior', 'warden', 'sms-vendor', 'rival-college'];
  it('gives the cast five distinct colours', () => {
    expect(new Set(cast.map(toneIndex)).size).toBe(5);
  });
  it('is deterministic for anyone else', () => {
    expect(avatarTone('bunty')).toBe(avatarTone('bunty'));
    expect(toneIndex('some-new-person')).toBeGreaterThanOrEqual(0);
    expect(toneIndex('some-new-person')).toBeLessThan(5);
  });
  it('uses only classes made from brief tokens', () => {
    for (const s of [...cast, 'x', 'y']) {
      const t = avatarTone(s);
      expect(t.avatar).toMatch(/^bg-(sky|flood-500|cap-purple|turf|wicket)\/15 /);
      expect(t.name).toMatch(/^text-(sky|flood-400|cap-purple|turf|wicket)$/);
    }
  });
  it('makes initials from a display name', () => {
    expect(initials('Teja')).toBe('T');
    expect(initials('Harry Bhaiya')).toBe('HB');
    expect(initials('  warden  sir  ')).toBe('WS');
    expect(initials('A B C')).toBe('AB');
    expect(initials('')).toBe('?');
  });
});
