import { renderToStaticMarkup } from 'react-dom/server';
import { expect, test } from 'vitest';
import { PhoneFrame } from '../src/features/phone/PhoneFrame';
import type { PhoneResult } from '../src/features/phone/request';
import { PHONE_SCREENS } from '../src/features/phone/screens';
import { SpreadStrip } from '../src/features/phone/SpreadView';
import type { ParsedTrace } from '../src/features/phone/trace';
import { Waterfall } from '../src/features/phone/WaterfallView';

const screen = PHONE_SCREENS[0]!;
const base: PhoneResult = {
  path: screen.path,
  status: 200,
  ok: true,
  ms: 40,
  body: { name: 'Asha', runs: 120 },
  served: 'learner',
  slots: ['cache.getPlayerStats'],
  trace: null,
};
const frame = (over: Partial<Parameters<typeof PhoneFrame>[0]>) =>
  renderToStaticMarkup(
    <PhoneFrame
      screen={screen}
      onScreen={() => undefined}
      loading={false}
      elapsedMs={0}
      result={base}
      {...over}
    />,
  );

test('one tab per screen, the open one selected', () => {
  const html = frame({});
  for (const s of PHONE_SCREENS) expect(html).toContain(`data-testid="phone-tab-${s.id}"`);
  expect(html.match(/aria-selected="true"/g)).toHaveLength(1);
});

test('while loading the phone shows the spinner and the time sat so far', () => {
  const html = frame({ loading: true, elapsedMs: 1500 });
  expect(html).toContain('data-testid="phone-spinner"');
  expect(html).toContain('1.50 s');
  expect(html).toContain('aria-busy="true"');
});

test('an answer shows the screen; an error shows the status as an alert', () => {
  expect(frame({})).toContain('Asha');
  const html = frame({
    result: { ...base, status: 500, ok: false, errorCode: 'slot_error', message: 'boom' },
  });
  expect(html).toContain('role="alert"');
  expect(html).toContain('500 slot_error');
});

const rows = (n: number) =>
  Array.from({ length: n }, (_, i) => ({
    kind: 'redis' as const,
    label: `GET k${i}`,
    startMs: i * 2,
    ms: 1.5,
    by: 'builtin' as const,
    ok: true,
  }));
const trace = (n: number): ParsedTrace => ({ totalMs: n * 2, calls: n, rows: rows(n) });

test('ten round trips draw ten bars and one pipeline draws one', () => {
  expect(renderToStaticMarkup(<Waterfall trace={trace(10)} />).match(/phone-bar/g)).toHaveLength(
    10,
  );
  expect(renderToStaticMarkup(<Waterfall trace={trace(1)} />).match(/phone-bar/g)).toHaveLength(1);
});

test('no trace and no calls are said in words', () => {
  expect(renderToStaticMarkup(<Waterfall trace={null} />)).toContain('No trace came back');
  expect(renderToStaticMarkup(<Waterfall trace={{ totalMs: 1, calls: 0, rows: [] }} />)).toContain(
    'no Redis command',
  );
});

test('the spread shows the numbers and mentions failures', () => {
  const html = renderToStaticMarkup(<SpreadStrip samples={[10, 20, 30]} failures={1} />);
  expect(html).toContain('3 requests');
  expect(html).toContain('1 failed');
  expect(renderToStaticMarkup(<SpreadStrip samples={[]} failures={0} />)).toBe('');
});
