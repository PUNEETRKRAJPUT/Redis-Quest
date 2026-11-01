// E-02: traffic on demand. A learner (or the UI's "Run traffic" button) puts the app under a scenario's load
// for a few seconds so a planted fault shows up in INFO, SLOWLOG and CLIENT LIST. Nothing is graded: no slot
// switching, no baseline. The run holds the verifier's per-player guard, so it cannot overlap a verification.

import type { Logger } from 'pino';
import type { EventBus, LevelEventData } from '../events.js';
import type { VerifyConfig } from '../verify/config.js';
import type { LoadRunner, LoadRunResult } from './run.js';
import { applyCaps, loadScenario } from './scenario.js';

export const MIN_DURATION_SEC = 1;
export const MAX_DURATION_SEC = 30;

/** A request the route refuses before anything starts (400). */
export class LoadRequestError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

export interface LoadStartResponse {
  scenario: string;
  durationSec: number;
  connections: number;
  startedAt: string;
  endsAt: string;
}

export interface LastLoadRun {
  scenario: string;
  requests: number;
  rps: number;
  p99Ms: number;
  /** 5xx plus requests that got no response at all. */
  errors: number;
  status5xx: number;
  finishedAt: string;
}

export interface LoadStatus {
  running: boolean;
  scenario: string | null;
  startedAt: string | null;
  endsAt: string | null;
  /** Engine clock, so a client can show a countdown without trusting its own clock. */
  now: string;
  last: LastLoadRun | null;
}

export interface OnDemandDeps {
  cfg: Pick<VerifyConfig, 'scenariosDir' | 'appUrl' | 'caps'>;
  bus: Pick<EventBus, 'emit'>;
  runLoad: LoadRunner;
  log?: Logger;
  now?: () => number;
}

interface Active {
  scenario: string;
  startedAt: number;
  endsAt: number;
  stop: (() => void) | null;
  stopRequested: boolean;
  finished: Promise<void>;
}

/** How long POST /api/load/stop waits for autocannon to notice (it checks once a second). */
const STOP_WAIT_MS = 4000;

export class OnDemandLoad {
  private active: Active | null = null;
  private last: LastLoadRun | null = null;
  private readonly now: () => number;

  constructor(private readonly d: OnDemandDeps) {
    this.now = d.now ?? Date.now;
  }

  private emit(name: string, data: Record<string, unknown>): void {
    this.d.bus.emit('level.event', { kind: 'custom', name, data } satisfies LevelEventData);
  }

  /**
   * Validates, loads the scenario (same caps as the verifier) and starts the run in the background.
   * `release` is the verifier guard's release function; it is called when the run ends, or by the caller
   * if this throws.
   */
  async start(
    req: { scenario?: unknown; durationSec?: unknown; connections?: unknown },
    release: () => void,
  ): Promise<LoadStartResponse> {
    if (typeof req.scenario !== 'string' || req.scenario === '')
      throw new LoadRequestError(
        'invalid_scenario',
        'scenario must be a scenario id like toss-time-100',
      );
    const d = req.durationSec;
    if (
      typeof d !== 'number' ||
      !Number.isInteger(d) ||
      d < MIN_DURATION_SEC ||
      d > MAX_DURATION_SEC
    )
      throw new LoadRequestError(
        'invalid_duration',
        `durationSec must be a whole number from ${MIN_DURATION_SEC} to ${MAX_DURATION_SEC}`,
      );
    const c = req.connections;
    if (c !== undefined && (typeof c !== 'number' || !Number.isInteger(c) || c < 1))
      throw new LoadRequestError(
        'invalid_connections',
        'connections must be a whole number of at least 1',
      );

    // Throws ScenarioError (the server maps it to 400 invalid_scenario).
    const scenario = await loadScenario(this.d.cfg.scenariosDir, req.scenario);
    const caps = this.d.cfg.caps;
    // Same caps as the verifier (LOAD_MAX_CONNECTIONS, LOAD_MAX_DURATION_SEC, LOW_POWER): too much is clamped.
    const durationSec = Math.min(d, caps.maxDurationSec);
    const connections = Math.min(c ?? applyCaps(scenario, caps).connections, caps.maxConnections);

    const startedAt = this.now();
    const endsAt = startedAt + durationSec * 1000;
    const active: Active = {
      scenario: scenario.id,
      startedAt,
      endsAt,
      stop: null,
      stopRequested: false,
      finished: Promise.resolve(),
    };
    this.active = active;
    this.emit('load_started', { scenario: scenario.id, durationSec });
    active.finished = this.d
      .runLoad({
        origin: new URL(this.d.cfg.appUrl).origin,
        scenario,
        connections,
        durationSec,
        onStart: (h) => {
          active.stop = h.stop;
          // stop() may have been asked for in the instant before autocannon handed us the handle.
          if (active.stopRequested) h.stop();
        },
      })
      .then(
        (r) => this.finish(active, r),
        (err: Error) => {
          this.d.log?.warn({ err: err.message, scenario: scenario.id }, 'traffic run failed');
          this.emit('load_failed', { scenario: scenario.id, message: err.message });
        },
      )
      .finally(() => {
        if (this.active === active) this.active = null;
        release();
      });
    return {
      scenario: scenario.id,
      durationSec,
      connections,
      startedAt: new Date(startedAt).toISOString(),
      endsAt: new Date(endsAt).toISOString(),
    };
  }

  private finish(active: Active, r: LoadRunResult): void {
    const errors = r.status5xx + r.connErrors;
    this.last = {
      scenario: active.scenario,
      requests: r.responses,
      rps: r.rps,
      p99Ms: r.p99Ms,
      errors,
      status5xx: r.status5xx,
      finishedAt: new Date(this.now()).toISOString(),
    };
    this.emit('load_finished', {
      scenario: active.scenario,
      requests: r.responses,
      rps: r.rps,
      p99Ms: r.p99Ms,
      errors,
    });
  }

  /** Ends a running run early. `stopped` is true when there was one to stop (the numbers still arrive as load_finished). */
  async stop(): Promise<{ stopped: boolean }> {
    const a = this.active;
    if (!a) return { stopped: false };
    a.stopRequested = true;
    a.stop?.();
    let timer: NodeJS.Timeout | undefined;
    const giveUp = new Promise((r) => {
      timer = setTimeout(r, STOP_WAIT_MS);
    });
    await Promise.race([a.finished, giveUp]);
    clearTimeout(timer);
    return { stopped: true };
  }

  status(): LoadStatus {
    const a = this.active;
    return {
      running: a !== null,
      scenario: a?.scenario ?? null,
      startedAt: a ? new Date(a.startedAt).toISOString() : null,
      endsAt: a ? new Date(a.endsAt).toISOString() : null,
      now: new Date(this.now()).toISOString(),
      last: this.last,
    };
  }
}
