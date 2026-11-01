// The verifier engine: turns a level's `verify` list into a verdict with per-check feedback.
// Verifiers run in list order (antipattern checks see the state earlier verifiers left, P0-05
// decision 24), except that `traffic` verifiers run after all the others. Every verifier runs, except
// that once the verdict is already `wrong` (for example a behavior verifier failed in the runner) a
// traffic run is skipped, so the learner's slot is never activated in the app, and an event check
// only looks back instead of waiting. Results are reported in list order. The verdict is the shared
// pure function `verdict()` from @quest/shared.

import {
  renderTemplates,
  verdict as decide,
  type EventVerifier,
  type LoadedLevel,
  type TemplateContext,
  type VerifySpec,
} from '@quest/shared';
import type { Logger } from 'pino';
import type { EventBus, LevelEventData } from '../events.js';
import { BaselineStore, type BaselineRecord } from '../load/baseline.js';
import { MetricsTap } from '../load/metrics-tap.js';
import { runLoad, type LoadRunner } from '../load/run.js';
import type { MetricsStore } from '../metrics.js';
import type { RedisManager } from '../redis.js';
import {
  httpRunner,
  loadFixtureSteps,
  runAssertions,
  runFixtureSteps,
  type RunFn,
} from './behavior.js';
import { crossCheckReadOnly, type CommandCheckReport } from './command-check.js';
import type { VerifyConfig } from './config.js';
import { describeEvent, EventLog, waitForEvent } from './events.js';
import { gradeAnswer, gradeQuiz } from './quiz-answer.js';
import { passedChecksText, runChecks, summarize } from './redis-checks.js';
import { slotFile } from './slots.js';
import { httpAppControl, TrafficRunner, type AppControl } from './traffic.js';
import type { CheckResult, SendCommand, VerifyOutcome } from './types.js';

export type { CheckResult, VerifyOutcome } from './types.js';

export type Answers = Record<string, string | string[]>;

export class VerifyBusyError extends Error {}

export const NO_ANTIPATTERN = 'No antipattern found.';
export const SKIPPED_TRAFFIC =
  'Skipped: another check already failed, so the load test was not run (your code is only put into the app once it passes in the runner).';

export interface VerifierDeps {
  cfg: VerifyConfig;
  log: Logger;
  bus: Pick<EventBus, 'emit' | 'subscribe' | 'since'>;
  redis: Pick<RedisManager, 'send' | 'client' | 'onUp' | 'isUp'> & { url: string };
  metrics?: Pick<MetricsStore, 'onPush'>;
  /** Overridable for tests. */
  run?: RunFn;
  runLoad?: LoadRunner;
  app?: AppControl;
}

export interface VerifyRequest {
  templateCtx: TemplateContext;
  startedAt?: string;
  attempt: number;
  answers: Answers;
}

/** Slots a level's learner code lives in: every `slot` named by its behavior-shaped verifiers. */
export function levelSlots(verify: readonly VerifySpec[]): string[] {
  const out = new Set<string>();
  for (const v of verify) if ('slot' in v && typeof v.slot === 'string') out.add(v.slot);
  return [...out].sort();
}

export class Verifier {
  readonly events: EventLog;
  readonly tap = new MetricsTap();
  readonly baselines: BaselineStore;
  readonly traffic: TrafficRunner;
  commandCheck: CommandCheckReport | { error: string } | null = null;
  private running = new Set<string>();
  private readonly run: RunFn;
  private readonly send: SendCommand;

  constructor(private readonly d: VerifierDeps) {
    this.events = new EventLog(d.bus);
    if (d.metrics) this.tap.attach(d.metrics);
    this.baselines = new BaselineStore(d.cfg.baselinesDir);
    this.run = d.run ?? httpRunner(d.cfg.runnerUrl);
    this.send = (argv) => d.redis.send(argv);
    this.traffic = new TrafficRunner({
      cfg: d.cfg,
      tap: this.tap,
      baselines: this.baselines,
      runLoad: d.runLoad ?? runLoad,
      app: d.app ?? httpAppControl(new URL(d.cfg.engineApi).origin, d.cfg.appUrl),
      log: d.log,
      onPhase: (phase, data) => this.progress('verify_traffic_phase', { phase, ...data }),
    });
  }

  /** Runs the READ_ONLY_COMMANDS cross-check each time a Redis target comes up (once per URL). */
  startCommandCheck(): void {
    let checkedUrl = '';
    const check = () => {
      if (checkedUrl === this.d.redis.url) return;
      checkedUrl = this.d.redis.url;
      crossCheckReadOnly(this.send).then(
        (r) => {
          this.commandCheck = r;
          const log = this.d.log;
          if (r.write.length)
            log.warn(
              { commands: r.write },
              'READ_ONLY_COMMANDS lists commands the server flags as write',
            );
          if (r.unknown.length)
            log.warn(
              { commands: r.unknown },
              'READ_ONLY_COMMANDS lists commands the server does not know',
            );
          if (r.neither.length)
            log.info(
              { commands: r.neither.map((x) => x.command) },
              'allowlisted commands without a readonly flag (no key access; expected for PING, INFO and similar)',
            );
          log.info(
            {
              total: r.total,
              readonlyFlagged: r.readonlyFlagged,
              write: r.write.length,
              unknown: r.unknown.length,
              readonlyNotListed: r.readonlyNotListed.length,
            },
            'read-only allowlist cross-checked against COMMAND INFO',
          );
        },
        (err: Error) => {
          this.commandCheck = { error: err.message };
          this.d.log.warn({ err: err.message }, 'read-only allowlist cross-check failed');
        },
      );
    };
    this.d.redis.onUp(check);
    // The engine connects before the server is built, so Redis may already be up.
    if (this.d.redis.isUp) check();
  }

  private progress(name: string, data: Record<string, unknown>): void {
    this.d.bus.emit('level.event', { kind: 'custom', name, data } satisfies LevelEventData);
  }

  /** One verification at a time per player (the route answers 409 otherwise). */
  begin(playerId: string): () => void {
    if (this.running.has(playerId))
      throw new VerifyBusyError('a verification is already running for this player');
    this.running.add(playerId);
    return () => this.running.delete(playerId);
  }

  async verify(level: LoadedLevel, req: VerifyRequest): Promise<VerifyOutcome> {
    const started = Date.now();
    const levelId = level.level.id;
    // Throws TemplateError on a bad template; the route reports it (a broken level must never pass).
    const specs = renderTemplates(level.level.verify, req.templateCtx) as VerifySpec[];
    const slots = levelSlots(specs);
    this.progress('verify_started', { levelId, attempt: req.attempt, total: specs.length });
    const checks: CheckResult[] = [];
    // Traffic runs last: it activates the learner's slot inside the app, where a synchronous infinite
    // loop cannot be stopped, so the code must first pass its behavior verifiers in the runner (which
    // can kill it). Every other verifier keeps list order.
    const order = [...specs.keys()]
      .filter((i) => specs[i]?.type !== 'traffic')
      .concat([...specs.keys()].filter((i) => specs[i]?.type === 'traffic'));
    for (const index of order) {
      const v = specs[index] as VerifySpec;
      const alreadyWrong = checks.some((c) => c.type !== 'antipattern' && !c.ok);
      this.progress('verify_check_started', { levelId, index, type: v.type });
      const t0 = Date.now();
      let r: Omit<CheckResult, 'index' | 'type' | 'durationMs'>;
      try {
        r = await this.runOne(level, v, index, req, slots, alreadyWrong);
      } catch (err) {
        r = {
          ok: false,
          message: `The engine could not run this check: ${(err as Error).message}`,
          details: { error: (err as Error).message },
        };
      }
      const result: CheckResult = { index, type: v.type, ...r, durationMs: Date.now() - t0 };
      checks.push(result);
      this.progress('verify_check_finished', {
        levelId,
        index,
        type: v.type,
        ok: result.ok,
        ...(result.skipped ? { skipped: true } : {}),
      });
    }
    checks.sort((a, b) => a.index - b.index);
    const verdict = decide(checks.map((c) => ({ type: c.type, passed: c.ok })));
    const outcome: VerifyOutcome = {
      verdict,
      levelId,
      attempt: req.attempt,
      startedAt: req.startedAt ?? null,
      checks,
      durationMs: Date.now() - started,
    };
    const traffic = checks.find((c) => c.type === 'traffic' && !c.skipped && c.details.run);
    if (traffic) outcome.metrics = { index: traffic.index, ...traffic.details };
    this.progress('verify_finished', { levelId, verdict, durationMs: outcome.durationMs });
    return outcome;
  }

  private async runOne(
    level: LoadedLevel,
    v: VerifySpec,
    index: number,
    req: VerifyRequest,
    slots: string[],
    alreadyWrong: boolean,
  ): Promise<Omit<CheckResult, 'index' | 'type' | 'durationMs'>> {
    switch (v.type) {
      case 'redis': {
        const items = await runChecks(this.send, v.checks);
        return { ...summarize(items, passedChecksText(items.length)), details: { items } };
      }
      case 'antipattern': {
        if ('checks' in v) {
          const items = await runChecks(this.send, v.checks);
          return { ...summarize(items, NO_ANTIPATTERN), details: { items } };
        }
        return this.behavior(
          level,
          {
            slot: v.slot,
            fixtures: v.fixtures,
            concurrency: v.concurrency,
            assertions: v.assertions,
          },
          req,
          NO_ANTIPATTERN,
        );
      }
      case 'behavior':
        return this.behavior(level, v, req, undefined, v.message);
      case 'traffic': {
        if (alreadyWrong)
          return {
            ok: false,
            skipped: true,
            message: SKIPPED_TRAFFIC,
            details: { scenario: v.scenario },
          };
        return this.traffic.grade(v, slots);
      }
      case 'event':
        return this.event(v, req, alreadyWrong);
      case 'quiz':
        return gradeQuiz(v, req.answers[String(index)]);
      case 'answer':
        return gradeAnswer(v, req.answers[String(index)], this.send);
    }
  }

  private async behavior(
    level: LoadedLevel,
    v: {
      slot: string;
      fixtures: string;
      concurrency?: number;
      assertions: Parameters<typeof runAssertions>[0]['assertions'];
    },
    req: VerifyRequest,
    passedText?: string,
    fallbackMessage?: string,
  ): Promise<Omit<CheckResult, 'index' | 'type' | 'durationMs'>> {
    const module = slotFile(v.slot);
    const details: Record<string, unknown> = { slot: v.slot, module: module ?? null };
    const steps = await loadFixtureSteps(level, v.fixtures, req.templateCtx);
    const fixtureError = await runFixtureSteps(steps, this.send);
    if (fixtureError) {
      return {
        ok: false,
        message: `The engine could not reset this level's state before calling your function (${fixtureError}).`,
        details,
      };
    }
    details.fixtures = { file: v.fixtures, steps: steps.length };
    const assertions = fallbackMessage
      ? v.assertions.map((a) => ({ ...a, message: a.message ?? fallbackMessage }))
      : v.assertions;
    const r = await runAssertions(
      { slot: v.slot, module, concurrency: v.concurrency, assertions },
      { run: this.run, send: this.send, redisUrl: this.d.redis.url },
    );
    details.concurrency = r.concurrency;
    details.assertions = r.reports;
    return { ok: r.ok, message: r.ok && passedText ? passedText : r.message, details };
  }

  private async event(
    v: EventVerifier,
    req: VerifyRequest,
    alreadyWrong: boolean,
  ): Promise<Omit<CheckResult, 'index' | 'type' | 'durationMs'>> {
    const cap = this.d.cfg.maxEventWaitMs;
    const waitMs = alreadyWrong ? 0 : Math.min(v.timeoutMs, cap ?? v.timeoutMs);
    const o = await waitForEvent(this.events, v, {
      ...(req.startedAt ? { sinceIso: req.startedAt } : {}),
      waitMs,
      ...(v.kind === 'channel_message' || v.kind === 'key_expired'
        ? { subscribe: (fn) => this.subscribeRedis(v, fn) }
        : {}),
    });
    const details: Record<string, unknown> = {
      kind: v.kind,
      match: v.match ?? {},
      how: o.how,
      waitedMs: o.waitedMs,
      since: req.startedAt ?? null,
    };
    if (o.event) details.event = o.event;
    if (o.ok) {
      return {
        ok: true,
        message:
          o.how === 'already_happened'
            ? `The game saw ${describeEvent(v)} at ${o.event?.at}.`
            : `The game saw ${describeEvent(v)} while it waited.`,
        details,
      };
    }
    const base =
      v.message ?? `The game has not seen ${describeEvent(v)} since you started this level.`;
    const why = alreadyWrong
      ? 'not waited for: an earlier check already failed'
      : `nothing since the level started, and nothing in ${Math.round(waitMs / 100) / 10} s of waiting`;
    return { ok: false, message: `${base} (${why})`, details };
  }

  /** channel_message: SUBSCRIBE on a duplicated client; key_expired: keyspace notifications (if enabled). */
  private async subscribeRedis(
    v: EventVerifier,
    fn: (d: LevelEventData) => void,
  ): Promise<() => Promise<void>> {
    const sub = this.d.redis.client().duplicate();
    sub.on('error', () => undefined);
    await sub.connect();
    if (v.kind === 'channel_message') {
      const channel = String(v.match?.channel);
      await sub.subscribe(channel, (message: string) =>
        fn({ kind: 'channel_message', data: { channel, message } }),
      );
    } else {
      await sub.pSubscribe('__keyevent@*__:expired', (key: string) =>
        fn({ kind: 'key_expired', data: { key } }),
      );
    }
    return async () => {
      try {
        await sub.close();
      } catch {
        sub.destroy();
      }
    };
  }

  async refreshBaseline(scenario: string, keepSlots: string[] | null): Promise<BaselineRecord> {
    return this.traffic.refresh(scenario, keepSlots);
  }
}
