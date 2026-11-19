// F-21: the match view's pure pieces: reveal timing, check ordering, expected/actual extraction, the match clock's
// tone, and the static markup of the verdict, the passed panel and the stage node.
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, test } from 'vitest';
import { clockTone } from '../src/level/interview';
import { Stage } from '../src/level/Stage';
import { VERDICT_COPY, VerdictBanner } from '../src/level/VerifyPanel';
import {
  BIG_SCREEN,
  LATE_BEAT_MS,
  MIN_PENDING_MS,
  evidenceOf,
  orderChecks,
  revealAt,
} from '../src/match/decision';
import { PassedPanel } from '../src/match/PassedPanel';
import type { InterviewInfo } from '../src/types';

test('the verdict waits at least the minimum, and only a short beat after a slow answer', () => {
  expect(MIN_PENDING_MS).toBeGreaterThanOrEqual(700);
  expect(LATE_BEAT_MS).toBeLessThanOrEqual(300);
  // fast answer: held until the minimum
  expect(revealAt(1000, 1100, false)).toBe(1000 + MIN_PENDING_MS);
  // slow answer: a beat after it, never more than 300ms
  const late = revealAt(1000, 1000 + MIN_PENDING_MS + 5000, false);
  expect(late - (1000 + MIN_PENDING_MS + 5000)).toBeLessThanOrEqual(300);
  // reduced motion: at once
  expect(revealAt(1000, 1100, true)).toBe(1100);
});

test('failing checks come first, each group in check order', () => {
  const out = orderChecks([
    { index: 0, ok: true },
    { index: 1, ok: false },
    { index: 2, ok: true },
    { index: 3, ok: false },
  ]);
  expect(out.map((c) => c.index)).toEqual([1, 3, 0, 2]);
});

test('expected and actual come out of every details shape the engine sends', () => {
  // redis checks
  expect(
    evidenceOf({
      items: [
        { cmd: 'GET a', ok: true, expected: '"1"', observed: '"1"' },
        { cmd: 'TTL a', ok: false, expected: 'at most 30', observed: '-1' },
      ],
    }),
  ).toEqual([{ label: 'TTL a', expected: 'at most 30', actual: '-1' }]);
  // traffic
  expect(
    evidenceOf({
      assertions: [{ key: 'db_queries_lte', ok: false, value: 29, needs: 'at most 3' }],
    }),
  ).toEqual([{ label: 'db_queries_lte', expected: 'at most 3', actual: '29' }]);
  // behaviour: side effects first, then feedback text
  expect(
    evidenceOf({
      assertions: [
        {
          ok: false,
          feedback: 'x',
          sideEffects: [{ cmd: 'EXISTS lock', ok: false, expected: '0', observed: '1' }],
        },
        { ok: false, feedback: 'expected null, got {"a":1} (call 2)' },
      ],
    }),
  ).toEqual([
    { label: 'EXISTS lock', expected: '0', actual: '1' },
    { expected: 'null', actual: '{"a":1}' },
  ]);
  // generic, nothing, and the cap
  expect(evidenceOf({ expected: 5, actual: 4 })).toEqual([{ expected: '5', actual: '4' }]);
  expect(evidenceOf(undefined)).toEqual([]);
  expect(evidenceOf({ question: 'q', picked: [] })).toEqual([]);
  const many = {
    items: Array.from({ length: 9 }, () => ({ ok: false, expected: 'a', observed: 'b' })),
  };
  expect(evidenceOf(many)).toHaveLength(4);
});

const iv = (over: Partial<InterviewInfo> = {}): InterviewInfo => ({
  minutes: 10,
  hintXpCost: 10,
  rebuildOf: null,
  startedAt: '2026-01-01T00:00:00Z',
  deadlineAt: null,
  overtime: false,
  overtimeMs: 0,
  hintsBought: 0,
  elapsedMs: null,
  ...over,
});

test('the match clock is calm, amber in the last fifth, red in overtime, green when done', () => {
  expect(clockTone(iv(), 300_000, false, 0)).toBe('calm');
  expect(clockTone(iv(), 120_000, false, 0)).toBe('late');
  expect(clockTone(iv(), 121_000, false, 0)).toBe('calm');
  expect(clockTone(iv({ overtime: true, overtimeMs: 5000 }), 0, false, 0)).toBe('over');
  expect(clockTone(iv(), null, false, 0)).toBe('waiting');
  expect(clockTone(iv({ elapsedMs: 100_000 }), 0, true, 0)).toBe('done');
});

test('the verdict card keeps its test id, verdict attribute and copy', () => {
  for (const v of ['right', 'wrong', 'works_but_wrong', 'not_implemented'] as const) {
    const html = renderToStaticMarkup(
      <VerdictBanner result={{ verdict: v, attempts: 2, status: 'in_progress', checks: [] }} />,
    );
    expect(html).toContain('data-testid="verdict"');
    expect(html).toContain(`data-verdict="${v}"`);
    expect(html).toContain(VERDICT_COPY[v].title);
    expect(BIG_SCREEN[v].word.length).toBeGreaterThan(0);
  }
  const wbw = renderToStaticMarkup(
    <VerdictBanner
      result={{
        verdict: 'works_but_wrong',
        attempts: 1,
        status: 'in_progress',
        checks: [{ index: 2, ok: false, message: 'A lock is left behind.' }],
      }}
    />,
  );
  expect(wbw).toContain('A lock is left behind.');
});

test('the passed panel shows the XP, the badge, "rebuilt in" and the next level', () => {
  const html = renderToStaticMarkup(
    <PassedPanel
      xp={60}
      badge="Nobody home"
      rebuilt="Rebuilt in 3:07."
      justPassed={false}
      next={{ id: 'ch2-06-x', title: 'Hit ratio' }}
      nextRef={{ current: null }}
      showMe={null}
    />,
  );
  expect(html).toContain('data-testid="passed-panel"');
  expect(html).toContain('+60');
  expect(html).toContain('Nobody home');
  expect(html).toMatch(/data-testid="rebuilt-in"[^>]*>Rebuilt in 3:07\.</);
  expect(html).toContain('data-testid="next-level"');
  expect(html).toContain('href="/level/ch2-06-x"');
  const last = renderToStaticMarkup(
    <PassedPanel
      xp={5}
      rebuilt={null}
      justPassed={false}
      next={null}
      nextRef={{ current: null }}
      showMe={null}
    />,
  );
  expect(last).not.toContain('next-level');
  expect(last).toContain('Back to the map');
});

test('a stage keeps its test id, toggle button first, and body only while open', () => {
  const closed = renderToStaticMarkup(
    <Stage n={6} title="The decision" open={false} onToggle={() => undefined}>
      <p>body</p>
    </Stage>,
  );
  expect(closed).toContain('data-testid="stage-6"');
  expect(closed).toContain('aria-expanded="false"');
  expect(closed).not.toContain('<p>body</p>');
  const open = renderToStaticMarkup(
    <Stage n={7} title="The ideal way" chip="unlocked" tone="done" open onToggle={() => undefined}>
      <p>body</p>
    </Stage>,
  );
  expect(open).toContain('aria-expanded="true"');
  expect(open).toContain('unlocked');
  expect(open).toContain('<p>body</p>');
  // the first button in the section is the toggle (the e2e helpers rely on it)
  expect(open.indexOf('<button')).toBeLessThan(open.indexOf('aria-expanded'));
});
