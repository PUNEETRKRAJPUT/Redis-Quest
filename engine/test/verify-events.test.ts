import { describe, expect, test } from 'vitest';
import { EventBus } from '../src/events.js';
import { EventLog, eventMatches, waitForEvent } from '../src/verify/events.js';

describe('eventMatches', () => {
  test('kind plus every match field, on the event or its data', () => {
    expect(
      eventMatches(
        { kind: 'custom', match: { name: 'ui_connected' } },
        { kind: 'custom', name: 'ui_connected' },
      ),
    ).toBe(true);
    expect(
      eventMatches(
        { kind: 'custom', match: { name: 'ui_connected' } },
        { kind: 'custom', name: 'cli_ping' },
      ),
    ).toBe(false);
    expect(eventMatches({ kind: 'redis_reconnect' }, { kind: 'redis_reconnect' })).toBe(true);
    expect(
      eventMatches(
        { kind: 'channel_message', match: { channel: 'c', message: '42' } },
        { kind: 'channel_message', data: { channel: 'c', message: 42 } },
      ),
    ).toBe(true);
    expect(
      eventMatches(
        { kind: 'custom', match: { name: 'x', level: 'a' } },
        { kind: 'custom', name: 'x', data: { level: 'b' } },
      ),
    ).toBe(false);
  });
});

describe('EventLog and waitForEvent', () => {
  test('already happened since startedAt, from the bus', async () => {
    const bus = new EventBus();
    const log = new EventLog(bus);
    const t0 = new Date(Date.now() - 1000);
    bus.emit('level.event', { kind: 'custom', name: 'ui_connected' });
    const o = await waitForEvent(
      log,
      { kind: 'custom', match: { name: 'ui_connected' } },
      { sinceIso: t0.toISOString(), waitMs: 0 },
    );
    expect(o).toMatchObject({ ok: true, how: 'already_happened' });
  });
  test('an event before startedAt does not count; waiting times out', async () => {
    const bus = new EventBus();
    const log = new EventLog(bus);
    bus.emit('level.event', { kind: 'custom', name: 'cli_ping' }, new Date(Date.now() - 60_000));
    const o = await waitForEvent(
      log,
      { kind: 'custom', match: { name: 'cli_ping' } },
      { sinceIso: new Date(Date.now() - 1000).toISOString(), waitMs: 50 },
    );
    expect(o).toMatchObject({ ok: false, how: 'timeout' });
  });
  test('arrives while waiting', async () => {
    const bus = new EventBus();
    const log = new EventLog(bus);
    setTimeout(() => bus.emit('level.event', { kind: 'redis_reconnect' }), 20);
    const o = await waitForEvent(log, { kind: 'redis_reconnect' }, { waitMs: 2000 });
    expect(o).toMatchObject({ ok: true, how: 'arrived' });
  });
  test("the verifier's own progress events never evict a real event", async () => {
    const bus = new EventBus();
    const log = new EventLog(bus);
    const since = new Date(Date.now() - 1000).toISOString();
    bus.emit('level.event', { kind: 'custom', name: 'ui_connected' });
    for (let i = 0; i < 5000; i++)
      bus.emit('level.event', { kind: 'custom', name: 'verify_check_started' });
    for (let i = 0; i < 300; i++) bus.emit('level.event', { kind: 'custom', name: 'cli_ping' });
    const o = await waitForEvent(
      log,
      { kind: 'custom', match: { name: 'ui_connected' } },
      { sinceIso: since, waitMs: 0 },
    );
    expect(o.ok).toBe(true);
  });
  test('extra subscription source (channel messages)', async () => {
    const log = new EventLog();
    const o = await waitForEvent(
      log,
      { kind: 'channel_message', match: { channel: 'score:42' } },
      {
        waitMs: 2000,
        subscribe: async (fn) => {
          setTimeout(
            () => fn({ kind: 'channel_message', data: { channel: 'score:42', message: 'six' } }),
            10,
          );
          return () => undefined;
        },
      },
    );
    expect(o).toMatchObject({ ok: true, how: 'arrived' });
  });
});
