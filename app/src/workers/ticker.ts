import {
  clientIsReady,
  createTargetClient,
  parseTarget,
  reconnectStrategyFor,
  type LearnerRedis,
} from '@quest/shared';
import type { Logger } from 'pino';
import type pg from 'pg';
import { sleep } from './common.js';

type Client = LearnerRedis;

export const TICKER_PREFIX = 'score:match:';

/** One ball as the learner's publisher sends it: JSON with an integer `seq`, anything else is kept as is. */
export interface TickerBall {
  seq: number;
  [k: string]: unknown;
}

export interface ChannelState {
  matchId: string;
  /** True while this instance holds a confirmed subscription (false during a resubscribe pause). */
  subscribed: boolean;
  /** Every message that arrived on the channel, malformed ones included. */
  received: number;
  /** `seq` of the most recent well-formed message; null until one arrives. */
  lastSeq: number | null;
  /** The most recent well-formed message. */
  last: TickerBall | null;
  /** The last 20 well-formed messages, oldest first. */
  recent: TickerBall[];
  /** Times a message arrived with `seq` beyond `lastSeq + 1`. */
  gaps: number;
  /** Messages that were not JSON or had no integer `seq`. */
  malformed: number;
}

/** What `GET /app/ticker/:matchId` answers. */
export interface TickerView extends ChannelState {
  instance: string;
}

const RING = 20;
const EVENT_TIMEOUT_MS = 3000;

/** Parse one payload; null when it is not a JSON object with an integer `seq`. */
export function parseBall(payload: string): TickerBall | null {
  try {
    const v = JSON.parse(payload) as unknown;
    if (typeof v !== 'object' || v === null || Array.isArray(v)) return null;
    const seq = (v as { seq?: unknown }).seq;
    if (typeof seq !== 'number' || !Number.isInteger(seq)) return null;
    return v as TickerBall;
  } catch {
    return null;
  }
}

export interface TickerOptions {
  instance: string;
  /** The app's raw pool (no injected latency); read once for the live matches. */
  pool: pg.Pool;
  /** The current Redis URL; it can change when the engine switches the target. */
  redisUrl: () => string;
  log: Logger;
  /** Engine base URL; undefined = no engine (gaps are counted and logged only). */
  engineUrl?: string;
}

export class TickerError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
  ) {
    super(code);
  }
}

/**
 * The provided subscriber for the ticker levels (3.5, 3.6). Every instance holds its own connection and
 * SUBSCRIBEs, by exact channel (not pattern), to `score:match:<id>` for every match that is live when the app
 * boots. It keeps in-memory stats per channel and reports sequence gaps to the engine: Pub/Sub is
 * at-most-once, so a subscriber that is away for a moment loses messages, and `ticker_gap` is how the
 * level shows that loss.
 */
export class TickerSubscriber {
  private readonly channels = new Map<string, ChannelState>();
  private readonly resubscribing = new Set<string>();
  private client?: Client;
  private clientUrl = '';
  private stopped = false;
  private ready: Promise<void> | undefined;

  constructor(private readonly o: TickerOptions) {}

  /** Match ids this instance subscribes to. */
  get matchIds(): string[] {
    return [...this.channels.keys()];
  }

  start(): void {
    this.ready = this.loop();
  }

  async stop(): Promise<void> {
    this.stopped = true;
    this.dropClient();
    await this.ready?.catch(() => undefined);
  }

  /** Stats for one channel, or null when this instance never subscribed to it. */
  view(matchId: string): TickerView | null {
    const s = this.channels.get(matchId);
    if (!s) return null;
    // Connected and subscribed; node-redis restores subscriptions by itself after a reconnect.
    const subscribed = s.subscribed && this.client !== undefined && clientIsReady(this.client);
    return { ...s, subscribed, recent: [...s.recent], instance: this.o.instance };
  }

  /**
   * Unsubscribe the channel on this instance, wait `pauseMs`, subscribe again. Resolves only after the new
   * subscription is confirmed by Redis. `lastSeq` is kept, so whatever was published during the pause shows
   * up as a gap on the first message afterwards.
   */
  async resubscribe(matchId: string, pauseMs: number): Promise<number> {
    const s = this.channels.get(matchId);
    if (!s) throw new TickerError(404, 'unknown_match');
    if (this.resubscribing.has(matchId)) throw new TickerError(409, 'resubscribe_in_progress');
    const c = this.client;
    if (!c || !clientIsReady(c) || !s.subscribed)
      throw new TickerError(503, 'ticker_not_connected');
    this.resubscribing.add(matchId);
    const started = Date.now();
    try {
      await c.unsubscribe(TICKER_PREFIX + matchId);
      s.subscribed = false;
      await sleep(pauseMs);
      // The client may have been replaced (Redis target switch) while paused; the loop owns that case.
      if (this.client === c && clientIsReady(c)) {
        await c.subscribe(TICKER_PREFIX + matchId, (m) => this.onMessage(matchId, m));
        s.subscribed = true;
      } else {
        for (let i = 0; i < 50 && !s.subscribed && !this.stopped; i++) await sleep(100);
        if (!s.subscribed) throw new TickerError(503, 'ticker_not_connected');
      }
    } finally {
      this.resubscribing.delete(matchId);
    }
    return Date.now() - started;
  }

  // ---- internals ---------------------------------------------------------------------------------

  private onMessage(matchId: string, payload: string): void {
    const s = this.channels.get(matchId);
    if (!s) return;
    s.received += 1;
    const ball = parseBall(payload);
    if (!ball) {
      s.malformed += 1;
      return;
    }
    const expected = s.lastSeq === null ? null : s.lastSeq + 1;
    if (expected !== null && ball.seq > expected) {
      s.gaps += 1;
      const data = {
        matchId,
        instance: this.o.instance,
        expected,
        got: ball.seq,
        missed: ball.seq - expected,
      };
      this.o.log.warn(data, 'ticker gap: messages were lost on this subscriber');
      this.reportGap(data);
    }
    s.lastSeq = ball.seq;
    s.last = ball;
    s.recent.push(ball);
    if (s.recent.length > RING) s.recent.shift();
  }

  private reportGap(data: Record<string, unknown>): void {
    const base = this.o.engineUrl;
    if (!base) return;
    // Fire and forget: the listener must never wait on the engine.
    fetch(`${base}/api/events`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ kind: 'custom', name: 'ticker_gap', data }),
      signal: AbortSignal.timeout(EVENT_TIMEOUT_MS),
    })
      .then((res) => {
        if (!res.ok) this.o.log.warn({ status: res.status }, 'ticker_gap event rejected by engine');
      })
      .catch((err: Error) => this.o.log.warn({ err: err.message }, 'ticker_gap event not sent'));
  }

  private makeClient(url: string): Client {
    // Any target kind: node-redis subscribes through a Sentinel client and a cluster client too (measured, A-05).
    const target = parseTarget(url);
    const c = createTargetClient(target, {
      disableOfflineQueue: true,
      connectTimeoutMs: 3000,
      reconnectStrategy: reconnectStrategyFor(target.kind),
    }) as unknown as Client;
    let lastMsg = '';
    c.on('error', (err: Error) => {
      if (err.message !== lastMsg) this.o.log.warn({ err: err.message }, 'ticker redis error');
      lastMsg = err.message;
    });
    c.on('ready', () => {
      lastMsg = '';
    });
    (c as unknown as { connect(): Promise<unknown> }).connect().catch(() => undefined);
    return c;
  }

  private dropClient(): void {
    const c = this.client;
    this.client = undefined;
    for (const s of this.channels.values()) s.subscribed = false;
    if (!c) return;
    try {
      void Promise.resolve(c.destroy()).catch(() => undefined);
    } catch {
      /* already closed */
    }
  }

  /** The live matches, read once. Postgres can still be loading its seed at boot, so retry. */
  private async loadLiveMatches(): Promise<string[]> {
    for (let attempt = 0; !this.stopped; attempt++) {
      try {
        const { rows } = await this.o.pool.query(
          "SELECT id FROM matches WHERE status = 'live' ORDER BY id",
        );
        return (rows as Array<{ id: string }>).map((r) => r.id);
      } catch (err) {
        if (attempt % 10 === 0)
          this.o.log.warn({ err: (err as Error).message }, 'ticker: live matches not readable yet');
        await sleep(1000);
      }
    }
    return [];
  }

  private async loop(): Promise<void> {
    const ids = await this.loadLiveMatches();
    for (const id of ids) {
      this.channels.set(id, {
        matchId: id,
        subscribed: false,
        received: 0,
        lastSeq: null,
        last: null,
        recent: [],
        gaps: 0,
        malformed: 0,
      });
    }
    this.o.log.info({ matches: ids }, 'ticker subscriber: live matches loaded');
    while (!this.stopped) {
      try {
        const url = this.o.redisUrl();
        if (!this.client || this.clientUrl !== url) {
          this.dropClient();
          this.client = this.makeClient(url);
          this.clientUrl = url;
        }
        const c = this.client;
        if (clientIsReady(c)) {
          for (const s of this.channels.values()) {
            // A channel mid-resubscribe is owned by resubscribe(), which puts it back itself.
            if (s.subscribed || this.resubscribing.has(s.matchId)) continue;
            await c.subscribe(TICKER_PREFIX + s.matchId, (m) => this.onMessage(s.matchId, m));
            s.subscribed = true;
            this.o.log.info({ channel: TICKER_PREFIX + s.matchId }, 'ticker subscribed');
          }
        }
      } catch (err) {
        this.o.log.warn({ err: (err as Error).message }, 'ticker subscribe failed; retrying');
      }
      await sleep(300);
    }
  }
}
