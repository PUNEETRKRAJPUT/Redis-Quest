// Fan-out of engine events to WebSocket clients, plus a ring of the last 200 verifier-relevant events
// (P0-09's `event` verifier asks "did this happen since the level started?").

export type EventType =
  | 'progress.changed'
  | 'level.event'
  | 'cli.dangerous'
  | 'metrics.tick'
  | 'log.line'
  | 'redis.state';

export interface EngineEvent<T = unknown> {
  type: EventType;
  at: string; // ISO 8601
  data: T;
}

/** `data` of a `level.event`. `kind` values match the level schema's EVENT_KINDS. */
export interface LevelEventData {
  kind: 'custom' | 'redis_disconnect' | 'redis_reconnect' | 'channel_message' | 'key_expired' | 'service_scaled';
  name?: string;
  data?: unknown;
}

/** One entry of the ring behind GET /api/events. */
export interface RecordedEvent {
  at: string;
  type: 'level.event' | 'redis.state';
  data: unknown;
}

export const EVENT_RING_SIZE = 200;

type Listener = (e: EngineEvent) => void;

export class EventBus {
  private listeners = new Set<Listener>();
  private ring: RecordedEvent[] = [];

  subscribe(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  emit<T>(type: EventType, data: T, at: Date = new Date()): void {
    const e: EngineEvent<T> = { type, at: at.toISOString(), data };
    if (type === 'level.event' || type === 'redis.state') {
      this.ring.push({ at: e.at, type, data });
      if (this.ring.length > EVENT_RING_SIZE) this.ring.shift();
    }
    for (const l of this.listeners) {
      try {
        l(e);
      } catch {
        // a broken listener must not stop the others
      }
    }
  }

  /** Events at or after `since` (ISO string), oldest first. */
  since(since?: string): RecordedEvent[] {
    if (!since) return [...this.ring];
    const t = Date.parse(since);
    if (Number.isNaN(t)) return [...this.ring];
    return this.ring.filter((e) => Date.parse(e.at) >= t);
  }
}
