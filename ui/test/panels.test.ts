import { describe, expect, test } from 'vitest';
import { colourReply, dangerNote } from '../src/panels/terminalText';
import { tickSeries } from '../src/panels/MetricsPanel';
import { hrefFor, parseHash } from '../src/router';

describe('terminal text', () => {
  test('dangerous commands are flagged, others are not', () => {
    for (const c of ['KEYS *', 'keys game:*', 'FLUSHALL', 'flushdb', 'MONITOR', 'DEBUG SLEEP 0'])
      expect(dangerNote(c)).toBeTruthy();
    for (const c of ['GET a', 'SCAN 0', 'PING', '']) expect(dangerNote(c)).toBeNull();
  });
  test('replies are coloured by type and keep line breaks terminal-safe', () => {
    expect(colourReply({ reply: '(error) ERR x', type: 'error', ms: 1 })).toContain('\x1b[31m');
    expect(colourReply({ reply: '1) "a"\n2) "b"', type: 'array', ms: 1 })).toBe('1) "a"\r\n2) "b"');
  });
});

describe('metrics', () => {
  test('db and redis series only exist when the app reports them', () => {
    const none = tickSeries([
      { at: 1, count: 3, errors: 0, p50Ms: 5, p99Ms: 9, routes: { 'GET /a': { count: 3 } } },
    ]);
    expect(none.db).toEqual([]);
    const some = tickSeries([
      {
        at: 1,
        count: 3,
        errors: 0,
        p50Ms: 5,
        p99Ms: 9,
        routes: { 'GET /a': { count: 3, dbQueries: 2 }, 'GET /b': { count: 1, dbQueries: 1 } },
      },
    ]);
    expect(some.db).toEqual([3]);
    expect(some.rps).toEqual([3]);
  });
});

describe('router', () => {
  test('hash routes round-trip', () => {
    expect(parseHash('')).toEqual({ name: 'home' });
    expect(parseHash('#/level/ch0-02-say-hello')).toEqual({
      name: 'level',
      id: 'ch0-02-say-hello',
    });
    expect(parseHash('#/terminal')).toEqual({ name: 'terminal' });
    expect(parseHash('#/zzz')).toEqual({ name: 'home' });
    expect(hrefFor({ name: 'level', id: 'a b' })).toBe('#/level/a%20b');
  });
});
