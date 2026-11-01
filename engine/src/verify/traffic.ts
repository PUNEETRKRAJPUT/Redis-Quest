// The `traffic` verifier: run a scenario against the app through the proxy and grade the numbers,
// absolute or relative to a baseline run of the same scenario with the level's learner slots off.

import type { TrafficVerifier } from '@quest/shared';
import type { Logger } from 'pino';
import {
  fingerprintDiff,
  type BaselineFingerprint,
  type BaselineRecord,
  type BaselineStore,
  type RunSummary,
} from '../load/baseline.js';
import type { MetricsTap } from '../load/metrics-tap.js';
import type { LoadRunner } from '../load/run.js';
import {
  applyCaps,
  loadScenario,
  scenarioHash,
  type EffectiveLoad,
  type Scenario,
} from '../load/scenario.js';
import type { VerifyConfig } from './config.js';

/** The app as the verifier controls it: engine config in, slot switches out, health to see them land. */
export interface AppControl {
  getConfig(): Promise<{ activeSlots: string[]; dbExtraLatencyMs: number }>;
  setSlots(slots: string[]): Promise<void>;
  /** Resolves once the app reports exactly these active slots; rejects with a learner-readable reason. */
  waitForSlots(slots: string[], timeoutMs: number): Promise<void>;
}

export class TrafficError extends Error {}

export interface TrafficDeps {
  cfg: VerifyConfig;
  tap: MetricsTap;
  baselines: BaselineStore;
  runLoad: LoadRunner;
  app: AppControl;
  log?: Logger;
  sleep?: (ms: number) => Promise<void>;
  onPhase?: (phase: 'baseline' | 'run', data: Record<string, unknown>) => void;
}

/** Quiet time between a warmup and the measured run, so per-second app metrics never mix the two. */
export const WARMUP_GAP_MS = 3200;
/** After the run, the app pushes the last second's metrics about a second later. */
export const METRICS_SETTLE_MS = 2500;
export const SLOT_SWITCH_TIMEOUT_MS = 12_000;
/** Applied when a level sets no error_rate_lte: a fast error is not a fast page. */
export const IMPLICIT_MAX_ERROR_RATE = 0.01;
/** A baseline run worse than this is not a baseline (the app or proxy is down). */
export const BASELINE_MAX_ERROR_RATE = 0.5;

const sortU = (xs: Iterable<string>) => [...new Set(xs)].sort();
const sameSet = (a: readonly string[], b: readonly string[]) =>
  JSON.stringify(sortU(a)) === JSON.stringify(sortU(b));
const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

function fmtMs(n: number): string {
  return `${n >= 100 ? Math.round(n) : Math.round(n * 10) / 10} ms`;
}
function fmtRatio(n: number): string {
  return String(Math.round(n * 1000) / 1000);
}
function pct(n: number): string {
  return `${Math.round(n * 1000) / 10}%`;
}

export interface AssertionVerdict {
  key: string;
  ok: boolean;
  value: number | null;
  needs: string;
  /** One line for the learner, e.g. "p99 ratio 0.83 (412 ms now vs 496 ms baseline), needs at most 0.2". */
  text: string;
}

/** Pure grading of one run (and its baseline) against a traffic verifier's assertions. */
export function evaluateTraffic(
  a: TrafficVerifier['assertions'],
  run: RunSummary,
  base: RunSummary | null,
): AssertionVerdict[] {
  const out: AssertionVerdict[] = [];
  const add = (key: string, ok: boolean, value: number | null, needs: string, text: string) =>
    out.push({ key, ok, value, needs, text });
  const app = run.app;
  const noApp = 'no app metrics arrived during the run, so this cannot be measured';

  if (run.load.ok2xx === 0) {
    add(
      'requests',
      false,
      0,
      'some successful responses',
      'no request got a successful response during the run',
    );
  }
  const ratio = (num: number, den: number) => (den > 0 ? num / den : null);

  if (a.p99_ratio_lte !== undefined) {
    const need = `at most ${a.p99_ratio_lte}`;
    const r = base ? ratio(run.load.p99Ms, base.load.p99Ms) : null;
    if (r === null)
      add('p99_ratio_lte', false, null, need, 'p99 ratio cannot be computed (no usable baseline)');
    else
      add(
        'p99_ratio_lte',
        r <= a.p99_ratio_lte,
        r,
        need,
        `p99 ratio ${fmtRatio(r)} (${fmtMs(run.load.p99Ms)} now vs ${fmtMs(base!.load.p99Ms)} baseline), needs ${need}`,
      );
  }
  if (a.rps_ratio_gte !== undefined) {
    const need = `at least ${a.rps_ratio_gte}`;
    const r = base ? ratio(run.load.rps, base.load.rps) : null;
    if (r === null)
      add(
        'rps_ratio_gte',
        false,
        null,
        need,
        'requests-per-second ratio cannot be computed (no usable baseline)',
      );
    else
      add(
        'rps_ratio_gte',
        r >= a.rps_ratio_gte,
        r,
        need,
        `throughput ratio ${fmtRatio(r)} (${run.load.rps} req/s now vs ${base!.load.rps} baseline), needs ${need}`,
      );
  }
  if (a.db_calls_ratio_lte !== undefined) {
    const need = `at most ${a.db_calls_ratio_lte}`;
    if (!app) add('db_calls_ratio_lte', false, null, need, `Postgres calls per request: ${noApp}`);
    else if (!base?.app || base.app.dbPerRequest === 0)
      add(
        'db_calls_ratio_lte',
        false,
        null,
        need,
        'Postgres calls ratio cannot be computed (the baseline has no Postgres calls to compare with)',
      );
    else {
      const r = app.dbPerRequest / base.app.dbPerRequest;
      add(
        'db_calls_ratio_lte',
        r <= a.db_calls_ratio_lte,
        r,
        need,
        `Postgres calls per request ratio ${fmtRatio(r)} (${app.dbPerRequest} per request now vs ${base.app.dbPerRequest} baseline), needs ${need}`,
      );
    }
  }
  if (a.hit_ratio_gte !== undefined) {
    const need = `at least ${a.hit_ratio_gte}`;
    if (!app) add('hit_ratio_gte', false, null, need, `cache hit ratio: ${noApp}`);
    else
      add(
        'hit_ratio_gte',
        app.hitRatio >= a.hit_ratio_gte,
        app.hitRatio,
        need,
        `cache hit ratio ${fmtRatio(app.hitRatio)} (${app.noDbCount} of ${app.requests} requests skipped Postgres), needs ${need}`,
      );
  }
  if (a.error_rate_lte !== undefined) {
    const need = `at most ${a.error_rate_lte}`;
    add(
      'error_rate_lte',
      run.load.errorRate <= a.error_rate_lte,
      run.load.errorRate,
      need,
      `error rate ${pct(run.load.errorRate)} (${run.load.status5xx} 5xx, ${run.load.connErrors} without a response), needs ${need}`,
    );
  } else {
    const ok = run.load.errorRate <= IMPLICIT_MAX_ERROR_RATE;
    add(
      'error_rate',
      ok,
      run.load.errorRate,
      `at most ${IMPLICIT_MAX_ERROR_RATE}`,
      ok
        ? `error rate ${pct(run.load.errorRate)}`
        : `${pct(run.load.errorRate)} of requests failed (${run.load.status5xx} 5xx, ${run.load.connErrors} without a response); a fast error is not a fast page`,
    );
  }
  if (a.db_queries_lte !== undefined) {
    const need = `at most ${a.db_queries_lte}`;
    if (!app) add('db_queries_lte', false, null, need, `Postgres queries: ${noApp}`);
    else
      add(
        'db_queries_lte',
        app.dbQueries <= a.db_queries_lte,
        app.dbQueries,
        need,
        `${app.dbQueries} Postgres queries during the run, needs ${need}`,
      );
  }
  if (a.p99_ms_lte !== undefined) {
    const need = `at most ${a.p99_ms_lte} ms`;
    add(
      'p99_ms_lte',
      run.load.p99Ms <= a.p99_ms_lte,
      run.load.p99Ms,
      need,
      `p99 ${fmtMs(run.load.p99Ms)}, needs ${need}`,
    );
  }
  return out;
}

export const DEFAULT_TRAFFIC_MESSAGE = 'Under load the app did not reach the target.';

export interface TrafficGrade {
  ok: boolean;
  message: string;
  details: Record<string, unknown>;
}

export function trafficMessage(
  v: Pick<TrafficVerifier, 'message'>,
  verdicts: AssertionVerdict[],
): { ok: boolean; message: string } {
  const failed = verdicts.filter((x) => !x.ok);
  if (failed.length === 0)
    return { ok: true, message: `Passed under load: ${verdicts.map((x) => x.text).join('; ')}.` };
  return {
    ok: false,
    message: `${v.message ?? DEFAULT_TRAFFIC_MESSAGE} (${failed.map((x) => x.text).join('; ')})`,
  };
}

export class TrafficRunner {
  private readonly sleep: (ms: number) => Promise<void>;

  constructor(private readonly d: TrafficDeps) {
    this.sleep = d.sleep ?? defaultSleep;
  }

  private origin(): string {
    return new URL(this.d.cfg.appUrl).origin;
  }

  /** Warmup (discarded), quiet gap, measured run, then the app metrics for exactly that window. */
  async measure(s: Scenario, eff: EffectiveLoad): Promise<RunSummary> {
    if (eff.warmup) {
      await this.d.runLoad({
        origin: this.origin(),
        scenario: s,
        connections: eff.warmup.connections,
        durationSec: eff.warmup.durationSec,
        seed: s.seed + 7919,
      });
      await this.sleep(WARMUP_GAP_MS);
    }
    const load = await this.d.runLoad({
      origin: this.origin(),
      scenario: s,
      connections: eff.connections,
      durationSec: eff.durationSec,
    });
    await this.sleep(METRICS_SETTLE_MS);
    const from = Math.floor(load.startedAt / 1000) * 1000 - 1000;
    const app = this.d.tap.window(from, load.finishedAt + 2000);
    return { load, app };
  }

  private async switchSlots(slots: string[]): Promise<void> {
    await this.d.app.setSlots(slots);
    await this.d.app.waitForSlots(slots, SLOT_SWITCH_TIMEOUT_MS);
  }

  /** Records (or re-records) the baseline for `scenario` with `baselineSlots` active. */
  async recordBaseline(
    s: Scenario,
    eff: EffectiveLoad,
    fp: BaselineFingerprint,
  ): Promise<BaselineRecord> {
    this.d.onPhase?.('baseline', { scenario: s.id, activeSlots: fp.activeSlots });
    await this.switchSlots(fp.activeSlots);
    const run = await this.measure(s, eff);
    if (run.load.ok2xx === 0 || run.load.errorRate > BASELINE_MAX_ERROR_RATE) {
      throw new TrafficError(
        `the baseline run of ${s.id} failed (${run.load.ok2xx} successful responses, error rate ${pct(run.load.errorRate)}); is the app up behind the proxy?`,
      );
    }
    const rec: BaselineRecord = {
      version: 1,
      scenario: s.id,
      recordedAt: new Date().toISOString(),
      fingerprint: fp,
      run,
    };
    await this.d.baselines.write(rec);
    this.d.log?.info(
      { scenario: s.id, p99Ms: run.load.p99Ms, rps: run.load.rps, app: run.app },
      'baseline recorded',
    );
    return rec;
  }

  fingerprint(
    s: Scenario,
    eff: EffectiveLoad,
    activeSlots: string[],
    dbExtraLatencyMs: number,
  ): BaselineFingerprint {
    return {
      scenarioHash: scenarioHash(s),
      activeSlots: sortU(activeSlots),
      dbExtraLatencyMs,
      connections: eff.connections,
      durationSec: eff.durationSec,
      appUrl: this.d.cfg.appUrl,
    };
  }

  /** POST /api/baselines/:scenario/refresh. Without level slots, the baseline runs with every slot off. */
  async refresh(scenarioId: string, keepSlots: string[] | null): Promise<BaselineRecord> {
    const s = await loadScenario(this.d.cfg.scenariosDir, scenarioId);
    const eff = applyCaps(s, this.d.cfg.caps);
    const cfgNow = await this.d.app.getConfig();
    const fp = this.fingerprint(s, eff, keepSlots ?? [], cfgNow.dbExtraLatencyMs);
    try {
      return await this.recordBaseline(s, eff, fp);
    } finally {
      await this.restore(cfgNow.activeSlots);
    }
  }

  private async restore(original: string[]): Promise<void> {
    try {
      const now = await this.d.app.getConfig();
      if (!sameSet(now.activeSlots, original)) await this.d.app.setSlots(original);
    } catch (err) {
      this.d.log?.warn(
        { err: (err as Error).message },
        'could not restore active slots after a traffic run',
      );
    }
  }

  async grade(v: TrafficVerifier, levelSlots: readonly string[]): Promise<TrafficGrade> {
    const s = await loadScenario(this.d.cfg.scenariosDir, v.scenario);
    const eff = applyCaps(s, this.d.cfg.caps);
    const cfgNow = await this.d.app.getConfig();
    const original = cfgNow.activeSlots;
    const details: Record<string, unknown> = {
      scenario: s.id,
      connections: eff.connections,
      durationSec: eff.durationSec,
      capped: eff.capped,
      levelSlots: [...levelSlots],
    };
    try {
      let base: RunSummary | null = null;
      if (v.baseline) {
        const fp = this.fingerprint(
          s,
          eff,
          original.filter((x) => !levelSlots.includes(x)),
          cfgNow.dbExtraLatencyMs,
        );
        const existing = await this.d.baselines.read(s.id);
        const diffs = existing ? fingerprintDiff(existing.fingerprint, fp) : ['none recorded yet'];
        let rec: BaselineRecord;
        if (existing && diffs.length === 0) {
          rec = existing;
          details.baseline = { recordedAt: rec.recordedAt, reused: true, run: rec.run };
        } else {
          rec = await this.recordBaseline(s, eff, fp);
          details.baseline = {
            recordedAt: rec.recordedAt,
            reused: false,
            recordedBecause: diffs,
            run: rec.run,
          };
        }
        base = rec.run;
      }
      const runSlots = sortU([...original, ...levelSlots]);
      this.d.onPhase?.('run', { scenario: s.id, activeSlots: runSlots });
      await this.switchSlots(runSlots);
      const run = await this.measure(s, eff);
      details.run = run;
      const verdicts = evaluateTraffic(v.assertions, run, base);
      details.assertions = verdicts;
      const { ok, message } = trafficMessage(v, verdicts);
      return { ok, message, details };
    } finally {
      await this.restore(original);
    }
  }
}

/** AppControl over HTTP: the engine's own API for slots, the app's /app/health to see them applied. */
export function httpAppControl(
  engineOrigin: string,
  appUrl: string,
  sleep = defaultSleep,
): AppControl {
  const base = appUrl.replace(/\/$/, '');
  return {
    async getConfig() {
      const res = await fetch(`${engineOrigin}/internal/app-config`, {
        signal: AbortSignal.timeout(5000),
      });
      if (!res.ok) throw new TrafficError(`engine app-config answered ${res.status}`);
      const b = (await res.json()) as { activeSlots?: string[]; dbExtraLatencyMs?: number };
      return { activeSlots: b.activeSlots ?? [], dbExtraLatencyMs: b.dbExtraLatencyMs ?? 0 };
    },
    async setSlots(slots) {
      const res = await fetch(`${engineOrigin}/api/slots`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ active: slots }),
        signal: AbortSignal.timeout(5000),
      });
      if (!res.ok)
        throw new TrafficError(
          `PUT /api/slots answered ${res.status}: ${(await res.text()).slice(0, 200)}`,
        );
    },
    async waitForSlots(slots, timeoutMs) {
      // Several instances may sit behind the proxy, so require a few matching answers in a row.
      const want = JSON.stringify(sortU(slots));
      const deadline = Date.now() + timeoutMs;
      let streak = 0;
      let last = 'no answer';
      while (Date.now() < deadline) {
        try {
          const res = await fetch(`${base}/health`, { signal: AbortSignal.timeout(2000) });
          const b = (await res.json()) as { activeSlots?: string[] };
          last = res.ok
            ? `active slots ${JSON.stringify(b.activeSlots ?? null)}`
            : `status ${res.status}`;
          if (
            res.ok &&
            Array.isArray(b.activeSlots) &&
            JSON.stringify(sortU(b.activeSlots)) === want
          ) {
            streak += 1;
            if (streak >= 4) return;
          } else streak = 0;
        } catch (err) {
          streak = 0;
          last = (err as Error).message;
        }
        await sleep(250);
      }
      throw new TrafficError(
        `the app did not switch to slots ${want} within ${Math.round(timeoutMs / 1000)} s (last: ${last}); is the app up behind the proxy?`,
      );
    },
  };
}
