// The `event` verifier: "did this happen since the level started, or does it happen while I wait?"
//
// The engine's own ring (events.ts) keeps 200 events and is shared with the verifier's own progress
// events, so a few verify attempts could push an early `ui_connected` out of it. The EventLog below
// subscribes from engine start, ignores the verifier's own `verify_*` progress events, keeps a larger
// ring, and keeps the latest event per kind, name and payload (bounded), so "already happened" cannot be evicted.

import type { EventVerifier, JsonValue } from '@quest/shared';
import type { EngineEvent, EventBus, LevelEventData } from '../events.js';

export interface LoggedEvent {
  at: string;
  t: number;
  data: LevelEventData;
}

export const VERIFY_EVENT_PREFIX = 'verify_';
const RING = 2000;
const LATEST_MAX = 500;

function isOwnProgress(d: LevelEventData): boolean {
  return (
    d.kind === 'custom' && typeof d.name === 'string' && d.name.startsWith(VERIFY_EVENT_PREFIX)
  );
}

export class EventLog {
  private ring: LoggedEvent[] = [];
  private latest = new Map<string, LoggedEvent>();
  private listeners = new Set<(e: LoggedEvent) => void>();

  constructor(bus?: Pick<EventBus, 'subscribe' | 'since'>) {
    if (!bus) return;
    for (const e of bus.since())
      if (e.type === 'level.event') this.add(e.at, e.data as LevelEventData);
    bus.subscribe((e: EngineEvent) => {
      if (e.type === 'level.event') this.add(e.at, e.data as LevelEventData);
    });
  }

  add(at: string, data: LevelEventData): void {
    if (!data || typeof data !== 'object' || isOwnProgress(data)) return;
    const e: LoggedEvent = { at, t: Date.parse(at), data };
    this.ring.push(e);
    if (this.ring.length > RING) this.ring.shift();
    // Latest per distinct event (kind, name and payload), bounded; re-inserting moves it to the end.
    let payload = '';
    try {
      payload = JSON.stringify(data.data ?? null).slice(0, 200);
    } catch {
      payload = '?';
    }
    const key = `${data.kind}|${data.name ?? ''}|${payload}`;
    this.latest.delete(key);
    this.latest.set(key, e);
    if (this.latest.size > LATEST_MAX)
      this.latest.delete(this.latest.keys().next().value as string);
    for (const l of this.listeners) l(e);
  }

  /** Events at or after `sinceMs`, oldest first, including the per-key latest ones the ring may have dropped. */
  since(sinceMs: number): LoggedEvent[] {
    const seen = new Set<LoggedEvent>();
    const out: LoggedEvent[] = [];
    for (const e of [...this.latest.values(), ...this.ring]) {
      if (e.t >= sinceMs && !seen.has(e)) {
        seen.add(e);
        out.push(e);
      }
    }
    return out.sort((a, b) => a.t - b.t);
  }

  onEvent(fn: (e: LoggedEvent) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }
}

function looseEqual(a: unknown, b: JsonValue): boolean {
  if (b === null || typeof b !== 'object') {
    if (a === b) return true;
    // Event payloads come from JSON bodies and Redis messages, so "42" and 42 are the same fact.
    return (
      (typeof a === 'string' || typeof a === 'number') &&
      (typeof b === 'string' || typeof b === 'number') &&
      String(a) === String(b)
    );
  }
  if (Array.isArray(b))
    return Array.isArray(a) && a.length === b.length && b.every((x, i) => looseEqual(a[i], x));
  if (!a || typeof a !== 'object' || Array.isArray(a)) return false;
  return Object.entries(b).every(([k, v]) => looseEqual((a as Record<string, unknown>)[k], v));
}

/**
 * An event matches when its kind is the verifier's kind and every `match` field equals the event's
 * field of that name, looked up on the event itself (`name`, `channel`, `key`, ...) and then on its
 * `data` payload. Extra fields on the event are ignored.
 */
export function eventMatches(v: Pick<EventVerifier, 'kind' | 'match'>, d: LevelEventData): boolean {
  if (d.kind !== v.kind) return false;
  for (const [k, want] of Object.entries(v.match ?? {})) {
    const top = (d as unknown as Record<string, unknown>)[k];
    const nested =
      d.data && typeof d.data === 'object' ? (d.data as Record<string, unknown>)[k] : undefined;
    // `kind` on the event itself is already matched above (it is `custom`), so a `kind` in the match can only mean
    // the payload's own field: redis_target_changed { kind: cluster } (E-03).
    const got = k === 'kind' && nested !== undefined ? nested : top !== undefined ? top : nested;
    if (!looseEqual(got, want)) return false;
  }
  return true;
}

export function describeEvent(v: Pick<EventVerifier, 'kind' | 'match'>): string {
  const m = v.match ?? {};
  switch (v.kind) {
    case 'custom':
      return `the "${String(m.name)}" event`;
    case 'channel_message':
      return `a message on channel ${String(m.channel)}`;
    case 'key_expired':
      return `key ${String(m.key)} expire`;
    case 'service_scaled':
      return `service ${String(m.service)} scale`;
    case 'redis_disconnect':
      return 'Redis disconnect';
    case 'redis_reconnect':
      return 'Redis come back after a disconnect';
  }
}

export interface EventWaitOptions {
  /** ISO time from which "already happened" counts (the level's startedAt). */
  sinceIso?: string;
  /** How long to wait for a new event; 0 means look back only. */
  waitMs: number;
  /** Extra source for kinds the engine bus never carries (channel messages via SUBSCRIBE). */
  subscribe?: (onMatch: (data: LevelEventData) => void) => Promise<() => Promise<void> | void>;
}

export interface EventOutcome {
  ok: boolean;
  how: 'already_happened' | 'arrived' | 'timeout';
  event?: { at: string; data: LevelEventData };
  waitedMs: number;
}

export async function waitForEvent(
  log: EventLog,
  v: Pick<EventVerifier, 'kind' | 'match'>,
  opts: EventWaitOptions,
): Promise<EventOutcome> {
  const since = opts.sinceIso ? Date.parse(opts.sinceIso) : 0;
  const past = log.since(Number.isNaN(since) ? 0 : since).find((e) => eventMatches(v, e.data));
  if (past)
    return {
      ok: true,
      how: 'already_happened',
      event: { at: past.at, data: past.data },
      waitedMs: 0,
    };
  if (opts.waitMs <= 0) return { ok: false, how: 'timeout', waitedMs: 0 };

  const started = Date.now();
  return new Promise<EventOutcome>((resolve) => {
    let done = false;
    let unsubscribeExtra: (() => Promise<void> | void) | undefined;
    const finish = (o: EventOutcome) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      off();
      void Promise.resolve(unsubscribeExtra?.()).catch(() => undefined);
      resolve(o);
    };
    const off = log.onEvent((e) => {
      if (eventMatches(v, e.data))
        finish({
          ok: true,
          how: 'arrived',
          event: { at: e.at, data: e.data },
          waitedMs: Date.now() - started,
        });
    });
    const timer = setTimeout(
      () => finish({ ok: false, how: 'timeout', waitedMs: Date.now() - started }),
      opts.waitMs,
    );
    if (opts.subscribe) {
      opts
        .subscribe((data) => {
          if (eventMatches(v, data))
            finish({
              ok: true,
              how: 'arrived',
              event: { at: new Date().toISOString(), data },
              waitedMs: Date.now() - started,
            });
        })
        .then((unsub) => {
          if (done) void Promise.resolve(unsub()).catch(() => undefined);
          else unsubscribeExtra = unsub;
        })
        .catch(() => undefined);
    }
  });
}
