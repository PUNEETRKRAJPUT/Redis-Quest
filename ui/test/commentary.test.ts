import { describe, expect, it } from 'vitest';
import { COMMENTARY, MOMENTS, momentForVerdict, nextCommentary } from '../src/commentary/lines';
import { commentaryLine, createPicker } from '../src/commentary/pick';
import { useSettings } from '../src/design/settings';
import { describeDanger, describeEvent } from '../src/shell/eventToasts';

describe('commentary tables', () => {
  for (const lang of ['hinglish', 'english'] as const) {
    it(`${lang}: every moment has several distinct, short, non-empty lines`, () => {
      for (const m of MOMENTS) {
        const lines = COMMENTARY[lang][m];
        expect(lines.length, `${lang}/${m}`).toBeGreaterThanOrEqual(3);
        expect(new Set(lines).size).toBe(lines.length);
        for (const l of lines) {
          expect(l.trim()).toBe(l);
          expect(l.length).toBeGreaterThan(8);
          expect(l.length).toBeLessThan(90);
        }
      }
    });
    it(`${lang}: no line states anything about Redis, and none uses money words`, () => {
      const all = MOMENTS.flatMap((m) => [...COMMENTARY[lang][m]]).join('\n');
      expect(all).not.toMatch(
        /redis|cache|key|ttl|expire|memory|database|postgres|server|command|\bbet\b|stake|payout|cash/i,
      );
    });
  }
  it('both languages carry the same moments', () => {
    expect(Object.keys(COMMENTARY.hinglish).sort()).toEqual([...MOMENTS].sort());
    expect(Object.keys(COMMENTARY.english).sort()).toEqual([...MOMENTS].sort());
  });
});

describe('the picker', () => {
  const table = COMMENTARY.english;
  it('rotates through every line before it repeats one', () => {
    const p = createPicker(table);
    const n = table.pass.length;
    const seen = Array.from({ length: n }, () => p.pick('pass'));
    expect(new Set(seen).size).toBe(n);
    expect(p.pick('pass')).toBe(seen[0]);
  });
  it('keeps a separate rotation per moment', () => {
    const p = createPicker(table);
    p.pick('pass');
    p.pick('pass');
    expect(p.pick('fail')).toBe(table.fail[0]);
  });
  it('starts where it is told to and wraps', () => {
    const p = createPicker(table, 1002);
    expect(p.pick('pass')).toBe(table.pass[1002 % table.pass.length]);
  });
  it('returns null for an empty moment', () => {
    expect(createPicker({ ...table, pass: [] }).pick('pass')).toBeNull();
  });
  it('is silent when commentary is off, and speaks in the chosen language otherwise', () => {
    expect(commentaryLine('off', 'pass')).toBeNull();
    expect(COMMENTARY.hinglish.pass).toContain(commentaryLine('hinglish', 'pass'));
    expect(COMMENTARY.english.fail).toContain(commentaryLine('english', 'fail'));
  });
});

describe('moments and the setting', () => {
  it('maps verdicts to moments; "no decision" has none', () => {
    expect(momentForVerdict('right')).toBe('pass');
    expect(momentForVerdict('wrong')).toBe('fail');
    expect(momentForVerdict('works_but_wrong')).toBe('works_but_wrong');
    expect(momentForVerdict('not_implemented')).toBeNull();
    expect(momentForVerdict(null)).toBeNull();
  });
  it('cycles hinglish, english, off', () => {
    expect(nextCommentary('hinglish')).toBe('english');
    expect(nextCommentary('english')).toBe('off');
    expect(nextCommentary('off')).toBe('hinglish');
  });
});

describe('where commentary shows in the shell', () => {
  it('a dangerous command keeps its plain note first and adds a line after it', () => {
    useSettings.setState({ commentary: 'english' });
    const on = describeDanger('KEYS');
    expect(on.description?.startsWith('KEYS blocks Redis while it scans every key.')).toBe(true);
    expect(on.description?.length).toBeGreaterThan(
      'KEYS blocks Redis while it scans every key. Use it for debugging only.'.length,
    );
    useSettings.setState({ commentary: 'off' });
    expect(describeDanger('KEYS').description).toBe(
      'KEYS blocks Redis while it scans every key. Use it for debugging only.',
    );
  });
  it('Redis going away and coming back toast only when commentary is on', () => {
    useSettings.setState({ commentary: 'off' });
    expect(describeEvent({ kind: 'redis_disconnect' })).toBeNull();
    expect(describeEvent({ kind: 'redis_reconnect' })).toBeNull();
    useSettings.setState({ commentary: 'hinglish' });
    const down = describeEvent({ kind: 'redis_disconnect' });
    expect(down?.title).toBe('Redis went away');
    expect(COMMENTARY.hinglish.stack_down).toContain(down?.description);
    const up = describeEvent({ kind: 'redis_reconnect' });
    expect(up?.tone).toBe('success');
    expect(COMMENTARY.hinglish.stack_back).toContain(up?.description);
  });
});
