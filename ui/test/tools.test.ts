// F-24: the pure parts of the rebuilt tools pages: log parsing and windowing, the Monaco theme against the design
// tokens, the impact figures, and the editor's file grouping. No DOM needed.
import { readFileSync } from 'node:fs';
import { describe, expect, test } from 'vitest';
import {
  countErrors,
  filterEntries,
  linesSince,
  parseLogLine,
  prettyRaw,
} from '../src/career/tools/logModel';
import { nightTheme, NIGHT, monoFontStack } from '../src/career/tools/monacoTheme';
import { bottomOffset, isAtBottom, visibleRange } from '../src/career/tools/windowing';
import { groupFiles, langOf } from '../src/panels/EditorPanel';
import { sparkPath } from '../src/panels/MetricsPanel';
import { headlineWin, metricFigures } from '../src/impact';

describe('log lines', () => {
  const caddy = JSON.stringify({
    level: 'info',
    ts: 1795048503.65,
    msg: 'handled request',
    request: { method: 'GET', uri: '/app/fixtures' },
    status: 200,
    duration: 0.0003,
  });
  test('pino json: level number, message, extra fields', () => {
    const e = parseLogLine(
      JSON.stringify({ level: 40, time: 1795046377770, name: 'app', msg: 'slow', route: '/x' }),
    );
    expect(e.level).toBe('warn');
    expect(e.text).toBe('slow');
    expect(e.extras).toEqual([['route', '/x']]);
    expect(e.time).toMatch(/^\d\d:\d\d:\d\d\.\d{3}$/);
  });
  test('caddy access lines read as request and status; 5xx is an error, 4xx a warning', () => {
    const ok = parseLogLine(caddy);
    expect(ok.text).toBe('GET /app/fixtures');
    expect(ok.meta).toBe('200 · 0.3 ms');
    expect(ok.level).toBe('info');
    expect(parseLogLine(caddy.replace('"status":200', '"status":503')).level).toBe('error');
    expect(parseLogLine(caddy.replace('"status":200', '"status":404')).level).toBe('warn');
  });
  test('postgres text lines and plain text', () => {
    const pg = parseLogLine('2026-11-19 00:04:57.800 UTC [163] LOG:  checkpoint starting: time');
    expect(pg).toMatchObject({ level: 'info', text: 'checkpoint starting: time' });
    expect(pg.time).toBe('00:04:57.800');
    expect(parseLogLine('2026-11-19 00:04:57.800 UTC [1] ERROR:  boom').level).toBe('error');
    expect(parseLogLine('2026-11-19 00:04:57.800 UTC [1] WARNING:  hmm').level).toBe('warn');
    expect(parseLogLine('Uncaught TypeError: x').level).toBe('error');
    expect(parseLogLine('{not json').text).toBe('{not json');
  });
  test('filters by level and by text, counts errors, finds what is new', () => {
    const lines = [
      JSON.stringify({ level: 30, msg: 'hello' }),
      JSON.stringify({ level: 50, msg: 'Redis Down' }),
      JSON.stringify({ level: 40, msg: 'careful' }),
    ];
    expect(filterEntries(lines, 'all', '')).toHaveLength(3);
    expect(filterEntries(lines, 'warn', '')).toHaveLength(2);
    expect(filterEntries(lines, 'error', '')).toHaveLength(1);
    expect(filterEntries(lines, 'all', 'redis down')).toHaveLength(1);
    expect(countErrors(lines)).toBe(1);
    expect(linesSince(lines.slice(0, 1), lines)).toBe(2);
    expect(linesSince(lines, lines)).toBe(0);
    expect(linesSince(['gone'], lines)).toBe(3);
    expect(prettyRaw(lines[0] as string)).toContain('\n  "msg": "hello"');
  });
});

describe('windowing', () => {
  test('only the rows in view plus overscan exist, clamped to the list', () => {
    expect(visibleRange(0, 280, 28, 1000, 8)).toEqual({ start: 0, end: 18 });
    expect(visibleRange(14000, 280, 28, 1000, 8)).toEqual({ start: 492, end: 518 });
    expect(visibleRange(99999, 280, 28, 1000, 8).end).toBe(1000);
    expect(visibleRange(0, 280, 28, 0)).toEqual({ start: 0, end: 0 });
  });
  test('bottom helpers', () => {
    expect(bottomOffset(1000, 280, 28)).toBe(27720);
    expect(bottomOffset(3, 280, 28)).toBe(0);
    expect(isAtBottom(27720, 280, 28000)).toBe(true);
    expect(isAtBottom(100, 280, 28000)).toBe(false);
  });
});

describe('monaco theme', () => {
  test('uses the palette literally (Monaco cannot read CSS variables)', () => {
    const css = readFileSync(new URL('../src/design/tokens.css', import.meta.url), 'utf8');
    const token = (n: string) =>
      new RegExp(`--color-${n}: *(#[0-9a-fA-F]{6});`).exec(css)?.[1]?.toUpperCase();
    expect(NIGHT.n900).toBe(token('night-900'));
    expect(NIGHT.n950).toBe(token('night-950'));
    expect(NIGHT.chalk).toBe(token('chalk'));
    expect(NIGHT.flood500).toBe(token('flood-500'));
    expect(NIGHT.sky).toBe(token('sky'));
    expect(nightTheme.colors['editor.background']).toBe(NIGHT.n900);
    expect(nightTheme.colors['editorCursor.foreground']).toBe(NIGHT.flood500);
    for (const v of Object.values(nightTheme.colors))
      expect(v).toMatch(/^#[0-9A-Fa-f]{6}([0-9A-Fa-f]{2})?$/);
  });
  test('font stack puts the self-hosted mono first', () => {
    expect(monoFontStack('"JB_abc", monospace')).toMatch(/^"JB_abc"/);
    expect(monoFontStack('')).toContain('JetBrains Mono');
  });
});

describe('editor helpers', () => {
  test('languages and grouping by folder, root first', () => {
    expect(langOf('a/b.js')).toBe('javascript');
    expect(langOf('README.md')).toBe('markdown');
    expect(langOf('x.bin')).toBe('plaintext');
    const g = groupFiles([
      { path: '_examples/ok.js', type: 'file' },
      { path: 'README.md', type: 'file' },
      { path: '_examples/hangs.js', type: 'file' },
    ]);
    expect(g.map((x) => x.dir)).toEqual(['', '_examples']);
    expect(g[1]?.files).toHaveLength(2);
  });
});

describe('metrics and impact', () => {
  test('sparkPath: empty, one point, a series', () => {
    expect(sparkPath([]).last).toBeNull();
    expect(sparkPath([5]).last).toEqual([100, 8]);
    const s = sparkPath([0, 10, 5]);
    expect(s.line.startsWith('M0.00,92.00')).toBe(true);
    expect(s.last?.[0]).toBe(100);
  });
  test('figures carry before, value and change; the headline is the biggest p99 drop', () => {
    const f = metricFigures({ p99Ms: 11, baselineP99Ms: 4100, rps: 1520, hitRatio: 0.987 });
    expect(f[0]).toMatchObject({ key: 'p99', before: '4,100', value: '11', change: -99.7 });
    expect(f.map((x) => x.key)).toEqual(['p99', 'hit', 'rps']);
    const win = headlineWin([
      {
        levelId: 'a',
        title: 'A',
        chapter: 'c',
        phrases: [],
        figures: [{ ...(f[0] as object), change: -50 } as never],
      },
      { levelId: 'b', title: 'B', chapter: 'c', phrases: [], figures: [f[0] as never] },
    ]);
    expect(win?.title).toBe('B');
    expect(headlineWin([])).toBeNull();
  });
});
