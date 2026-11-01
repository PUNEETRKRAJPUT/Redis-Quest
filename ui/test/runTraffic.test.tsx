// E-02: the "Run traffic" button. The UI has no DOM test environment, so the view renders to static markup and the
// click is the same function the button calls, run against a fake route (the pattern of slotToggle.test.tsx).
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, test } from 'vitest';
import { ApiError } from '../src/api';
import {
  clickRunTraffic,
  describeLast,
  remainingSeconds,
  RunTrafficView,
  TRAFFIC_BLOCKED_COPY,
} from '../src/level/RunTraffic';

const started = {
  scenario: 'toss-time-100',
  durationSec: 10,
  connections: 50,
  startedAt: '2026-11-01T10:00:00.000Z',
  endsAt: '2026-11-01T10:00:10.000Z',
};

test('idle: the button says what it runs and for how long', () => {
  const html = renderToStaticMarkup(<RunTrafficView scenario="toss-time-100" />);
  expect(html).toContain('data-testid="run-traffic"');
  expect(html).toContain('Run traffic: toss-time-100 (10 s)');
  expect(html).not.toContain('disabled');
  expect(html).not.toContain('Last run');
});

test('clicking asks the engine for a 10 second run of that scenario', async () => {
  const calls: Array<[string, number]> = [];
  const out = await clickRunTraffic('toss-time-100', async (scenario, durationSec) => {
    calls.push([scenario, durationSec]);
    return started;
  });
  expect(calls).toEqual([['toss-time-100', 10]]);
  expect(out).toEqual({ kind: 'started', endsAtMs: Date.parse(started.endsAt) });
});

test('running: disabled, shows the seconds left', () => {
  const html = renderToStaticMarkup(
    <RunTrafficView scenario="toss-time-100" running remainingSec={7} />,
  );
  expect(html).toContain('running… 7 s');
  expect(html).toContain('disabled');
  expect(html).toContain('data-running="true"');
  expect(html).not.toContain('Run traffic:');
});

test('the countdown is read from the engine clock when it sent one', () => {
  const ends = Date.parse('2026-11-01T10:00:10.000Z');
  // The browser clock is 3 s ahead of the engine's: it must not cut the countdown short.
  const browserNow = Date.parse('2026-11-01T10:00:05.000Z') + 3000;
  const engineNow = Date.parse('2026-11-01T10:00:05.000Z');
  expect(remainingSeconds(ends, browserNow, engineNow)).toBe(5);
  expect(remainingSeconds(ends, browserNow)).toBe(2);
  expect(remainingSeconds(ends, ends + 5000)).toBe(0);
  expect(remainingSeconds(ends, ends - 1500)).toBe(2);
});

test('finished: the last run shows req/s, p99 and errors', () => {
  const last = {
    scenario: 'toss-time-100',
    requests: 2400,
    rps: 239.6,
    p99Ms: 42.46,
    errors: 3,
    status5xx: 2,
  };
  expect(describeLast(last)).toBe('240 req/s, p99 42.5 ms, 3 errors');
  const html = renderToStaticMarkup(<RunTrafficView scenario="toss-time-100" last={last} />);
  expect(html).toContain('data-testid="run-traffic-last"');
  expect(html).toContain('Last run of toss-time-100: 240 req/s, p99 42.5 ms, 3 errors');
});

test('a 409 verify_in_progress says to wait for the verifier and disables the button', async () => {
  const out = await clickRunTraffic('toss-time-100', async () => {
    throw new ApiError(
      409,
      'verify_in_progress',
      'a verification or a traffic run is already running',
    );
  });
  expect(out).toEqual({ kind: 'blocked', message: TRAFFIC_BLOCKED_COPY });
  const html = renderToStaticMarkup(<RunTrafficView scenario="toss-time-100" blocked />);
  expect(html).toContain('wait for the verifier');
  expect(html).toContain('disabled');
  expect(html).not.toContain('Run traffic:');
});

test('any other failure shows its message and leaves the button usable', async () => {
  const out = await clickRunTraffic('toss-time-100', async () => {
    throw new ApiError(0, 'offline', 'Cannot reach the game engine.');
  });
  expect(out).toEqual({ kind: 'failed', message: 'Cannot reach the game engine.' });
  const html = renderToStaticMarkup(
    <RunTrafficView scenario="toss-time-100" message="Cannot reach the game engine." />,
  );
  expect(html).toContain('data-testid="run-traffic-msg"');
  expect(html).toContain('Cannot reach the game engine.');
  expect(html).not.toContain('disabled');
});
