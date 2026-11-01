import type { Logger } from 'pino';
import { parseTarget } from '@quest/shared';
import type { MetricsRecorder, RouteSecond } from './metrics.js';

/** What the engine serves at GET /internal/app-config. */
export interface AppConfig {
  target: { redisUrl: string };
  activeSlots: string[];
  dbExtraLatencyMs: number;
}

export function parseAppConfig(body: unknown): AppConfig {
  const b = (body ?? {}) as Record<string, unknown>;
  const target = b.target as Record<string, unknown> | undefined;
  if (!target || typeof target.redisUrl !== 'string') {
    throw new Error('target.redisUrl must be a redis://, sentinel:// or cluster:// URL');
  }
  try {
    parseTarget(target.redisUrl);
  } catch (err) {
    throw new Error(`target.redisUrl is not a valid target: ${(err as Error).message}`);
  }
  if (!Array.isArray(b.activeSlots) || !b.activeSlots.every((s) => typeof s === 'string')) {
    throw new Error('activeSlots must be a list of strings');
  }
  const lat = b.dbExtraLatencyMs ?? 0;
  if (typeof lat !== 'number' || !Number.isFinite(lat) || lat < 0)
    throw new Error('dbExtraLatencyMs must be >= 0');
  return {
    target: { redisUrl: target.redisUrl },
    activeSlots: [...b.activeSlots] as string[],
    dbExtraLatencyMs: Math.min(lat, 5000),
  };
}

/**
 * Pulls the engine's app config every `intervalMs` with If-None-Match. Each instance pulls on its own,
 * so any number of instances converge without the engine knowing how many exist. Unreachable engine or
 * a bad body: keep the last applied config and try again next tick.
 */
export class ConfigPoller {
  etag?: string;
  lastOkAt?: string;
  engineUp = false;
  private timer?: NodeJS.Timeout;
  private stopped = false;

  constructor(
    private readonly url: string,
    private readonly intervalMs: number,
    private readonly apply: (cfg: AppConfig) => Promise<void>,
    private readonly log: Logger,
  ) {}

  start(): void {
    const tick = async () => {
      await this.pollOnce();
      if (!this.stopped) this.timer = setTimeout(tick, this.intervalMs);
    };
    void tick();
  }

  /** One pull. Returns 'changed', 'unchanged' or 'error' (also used by tests). */
  async pollOnce(): Promise<'changed' | 'unchanged' | 'error'> {
    try {
      const res = await fetch(`${this.url}/internal/app-config`, {
        headers: this.etag ? { 'if-none-match': this.etag } : {},
        signal: AbortSignal.timeout(Math.max(500, Math.min(this.intervalMs, 3000))),
      });
      this.markUp(true);
      this.lastOkAt = new Date().toISOString();
      if (res.status === 304) return 'unchanged';
      if (res.status !== 200) throw new Error(`engine answered ${res.status}`);
      const body = (await res.json()) as Record<string, unknown>;
      const cfg = parseAppConfig(body);
      // Prefer the header (it is what If-None-Match must echo); fall back to the body's bare etag.
      const etag =
        res.headers.get('etag') ?? (typeof body.etag === 'string' ? `"${body.etag}"` : undefined);
      await this.apply(cfg);
      this.etag = etag;
      return 'changed';
    } catch (err) {
      this.markUp(false, (err as Error).message);
      return 'error';
    }
  }

  private markUp(up: boolean, why?: string): void {
    if (up !== this.engineUp) {
      if (up) this.log.info({ engine: this.url }, 'engine reachable; following its app config');
      else
        this.log.warn(
          { engine: this.url, err: why },
          'engine config pull failed; keeping the last config',
        );
    }
    this.engineUp = up;
  }

  stop(): void {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
  }
}

export interface MetricsPushBody {
  /** The spec's field name. */
  instance: string;
  /** The same value under the name the P0-06 engine validates. */
  instanceId: string;
  /** Epoch ms of the start of the reported window (aligned to the push interval). */
  at: number;
  windowMs: number;
  /** The app-config ETag this instance had applied, so a verifier can wait for every instance to converge. */
  configEtag: string | null;
  activeSlots: string[];
  routes: Record<string, RouteSecond>;
}

/**
 * Every `intervalMs`, on wall-clock boundaries (the engine buckets by second; unaligned windows would
 * overwrite each other), drain the recorder and POST the window. Empty windows are pushed too: they are
 * the instance's heartbeat in the engine's instance list. A failed push drops that window.
 */
export class MetricsPusher {
  private timer?: NodeJS.Timeout;
  private stopped = false;
  private failing = false;
  lastBody?: MetricsPushBody;

  constructor(
    private readonly url: string | undefined,
    private readonly intervalMs: number,
    private readonly recorder: MetricsRecorder,
    private readonly info: () => {
      instance: string;
      configEtag: string | null;
      activeSlots: string[];
    },
    private readonly log: Logger,
  ) {}

  start(): void {
    const schedule = () => {
      const now = Date.now();
      const next = Math.ceil((now + 1) / this.intervalMs) * this.intervalMs;
      this.timer = setTimeout(() => {
        void this.pushWindow(next - this.intervalMs);
        if (!this.stopped) schedule();
      }, next - now);
    };
    schedule();
  }

  async pushWindow(at: number): Promise<void> {
    const i = this.info();
    const body: MetricsPushBody = {
      instance: i.instance,
      instanceId: i.instance,
      at,
      windowMs: this.intervalMs,
      configEtag: i.configEtag,
      activeSlots: i.activeSlots,
      routes: this.recorder.drain(),
    };
    this.lastBody = body;
    if (!this.url) return;
    try {
      const res = await fetch(`${this.url}/internal/metrics`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(Math.max(500, this.intervalMs - 100)),
      });
      if (!res.ok)
        throw new Error(`engine answered ${res.status}: ${(await res.text()).slice(0, 200)}`);
      if (this.failing) this.log.info('metrics push recovered');
      this.failing = false;
    } catch (err) {
      if (!this.failing)
        this.log.warn(
          { err: (err as Error).message },
          'metrics push failed; dropping windows until the engine answers',
        );
      this.failing = true;
    }
  }

  stop(): void {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
  }
}
