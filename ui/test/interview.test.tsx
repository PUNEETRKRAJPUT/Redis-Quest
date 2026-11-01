import { renderToStaticMarkup } from 'react-dom/server';
import { expect, test } from 'vitest';
import {
  clockView,
  Countdown,
  formatClock,
  hintButtonLabel,
  hintCostCopy,
  RebuildLink,
  rebuiltIn,
  signedRemaining,
} from '../src/level/interview';
import type { InterviewInfo, LevelData } from '../src/types';

const iv = (over: Partial<InterviewInfo> = {}): InterviewInfo => ({
  minutes: 10,
  hintXpCost: 10,
  rebuildOf: { id: 'example-code-01-cache-aside', title: 'Cache-aside, version one' },
  startedAt: '2026-11-01T10:00:00.000Z',
  deadlineAt: '2026-11-01T10:10:00.000Z',
  overtime: false,
  overtimeMs: 0,
  hintsBought: 0,
  elapsedMs: null,
  ...over,
});

test('formatClock: m:ss, countdown rounds up and elapsed rounds down', () => {
  expect(formatClock(0)).toBe('0:00');
  expect(formatClock(59_999)).toBe('0:59');
  expect(formatClock(59_001, 'up')).toBe('1:00');
  expect(formatClock(600_000, 'up')).toBe('10:00');
  expect(formatClock(3_725_000)).toBe('62:05');
  expect(formatClock(-5000)).toBe('0:00');
});

test('signedRemaining counts down through zero into overtime', () => {
  expect(signedRemaining(60_000, 0, 0)).toBe(60_000);
  expect(signedRemaining(60_000, 0, 61_000)).toBe(-1000);
  // the engine clamps remaining at 0 and reports how far past it is
  expect(signedRemaining(0, 31_000, 4000)).toBe(-35_000);
});

test('clockView: waiting, running, overtime, done', () => {
  expect(clockView(iv({ startedAt: null }), null, false, 0)).toEqual({
    state: 'waiting',
    text: '10:00 starts when you begin',
  });
  expect(clockView(iv(), 542_000, false, 0)).toEqual({ state: 'running', text: '9:02 left' });
  expect(clockView(iv(), 542_000, false, 2500)).toEqual({ state: 'running', text: '9:00 left' });
  expect(clockView(iv(), 1000, false, 1000)).toEqual({ state: 'running', text: '0:00 left' });
  expect(clockView(iv({ overtime: true, overtimeMs: 31_000 }), 0, false, 4000)).toEqual({
    state: 'overtime',
    text: 'Overtime +0:35',
  });
  expect(clockView(iv({ elapsedMs: 187_000 }), 413_000, true, 0)).toEqual({
    state: 'done',
    text: 'Rebuilt in 3:07',
  });
  expect(clockView(iv({ elapsedMs: 650_000, overtime: true }), 0, true, 0).text).toBe(
    'Rebuilt in 10:50 (overtime)',
  );
});

test('rebuiltIn: only once passed, and overtime is said plainly', () => {
  expect(rebuiltIn(null)).toBeNull();
  expect(rebuiltIn(iv())).toBeNull();
  expect(rebuiltIn(iv({ elapsedMs: 187_000 }))).toBe('rebuilt in 3:07');
  expect(rebuiltIn(iv({ elapsedMs: 650_000, overtime: true }))).toBe(
    'rebuilt in 10:50, over the 10:00 limit',
  );
});

test('hint prompt copy says what it costs, and what a poor learner really pays', () => {
  expect(hintCostCopy(10, 240)).toBe(
    'This hint costs 10 XP. You have 240 XP, so you would keep 230.',
  );
  expect(hintCostCopy(10, 3)).toContain('takes all of it and you keep 0');
  expect(hintCostCopy(0, 5)).toBe('This hint is free.');
  expect(hintButtonLabel(10, 0, 2)).toBe('Show a hint (costs 10 XP) (0 of 2)');
  expect(hintButtonLabel(0, 1, 2)).toBe('Show a hint (free) (1 of 2)');
  expect(hintButtonLabel(10, 2, 2)).toBe('No more hints');
});

const level = (over: Partial<LevelData>): LevelData =>
  ({ status: 'in_progress', ...over }) as LevelData;

test('Countdown renders nothing on an ordinary level and a timer on an interview level', () => {
  expect(renderToStaticMarkup(<Countdown level={level({ interview: null })} />)).toBe('');
  const html = renderToStaticMarkup(
    <Countdown level={level({ interview: iv(), remainingMs: 600_000 })} />,
  );
  expect(html).toContain('data-testid="countdown"');
  expect(html).toContain('data-state="running"');
  expect(html).toContain('role="timer"');
  expect(html).toMatch(/10:00 left|9:5\d left/);
});

test('Countdown shows overtime plainly and a frozen time after a pass', () => {
  const late = renderToStaticMarkup(
    <Countdown
      level={level({ interview: iv({ overtime: true, overtimeMs: 61_000 }), remainingMs: 0 })}
    />,
  );
  expect(late).toContain('data-state="overtime"');
  expect(late).toMatch(/Overtime \+1:0\d/);
  const done = renderToStaticMarkup(
    <Countdown
      level={level({
        status: 'passed',
        interview: iv({ elapsedMs: 187_000 }),
        remainingMs: 413_000,
      })}
    />,
  );
  expect(done).toContain('data-state="done"');
  expect(done).toContain('Rebuilt in 3:07');
});

test('the ideal-way panel links to the rebuilt level', () => {
  const html = renderToStaticMarkup(<RebuildLink interview={iv()} />);
  expect(html).toContain('href="#/level/example-code-01-cache-aside"');
  expect(html).toContain('Cache-aside, version one');
});
