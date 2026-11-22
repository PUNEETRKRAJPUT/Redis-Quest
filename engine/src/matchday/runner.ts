// The match: six overs, each a load run of ten seconds through the engine's own on-demand traffic route, with an
// incident card before some of them. One match at a time. Everything a card changes is undone after the over it
// belongs to, and again when the match ends however it ends (finished, all out, stopped, an error).

import type { Logger } from 'pino';
import {
  buildFixture,
  cardInfo,
  innings,
  OVERS,
  scorecardText,
  scoreOver,
  summarizeMatch,
  type Deck,
  type EndedBy,
  type IncidentCard,
  type MatchFixture,
  type MatchResult,
  type OverPlan,
  type OverScore,
} from '@quest/shared';
import type { EventBus, LevelEventData } from '../events.js';
import {
  deleteKeys,
  lowerMaxmemory,
  restoreMaxmemory,
  runBlockScript,
  type RedisPort,
  type UndoJournal,
} from './changes.js';
import type { ResultsStore } from './files.js';
import type { MatchPhase, MatchStatus, PlayedCard, PublicFixture } from './types.js';

export interface LoadStartOutcome {
  ok: boolean;
  status: number;
  code: string;
  message: string;
}

export interface LoadStatusView {
  running: boolean;
  last: {
    scenario: string;
    requests: number;
    rps: number;
    p99Ms: number;
    errors: number;
    status5xx: number;
    finishedAt: string;
  } | null;
}

/** The engine's on-demand traffic (POST /api/load/start, GET /api/load/status, POST /api/load/stop). */
export interface LoadPort {
  start(o: {
    scenario: string;
    durationSec: number;
    connections: number;
  }): Promise<LoadStartOutcome>;
  status(): Promise<LoadStatusView>;
  stop(): Promise<void>;
}

export interface RunnerRedis extends RedisPort {
  readonly isUp: boolean;
  readonly kind: string | null;
}

export interface RunnerDeps {
  redis: RunnerRedis;
  load: LoadPort;
  bus: Pick<EventBus, 'emit'>;
  journal: UndoJournal;
  results: Pick<ResultsStore, 'add'>;
  loadDeck: () => Promise<Deck>;
  log?: Pick<Logger, 'warn' | 'error' | 'info'>;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  /** How often the runner asks whether the over's traffic has ended. */
  pollMs?: number;
  /** How many times a refused traffic start (something else holds the guard) is retried between overs. */
  retriesBetweenOvers?: number;
}

/** A start the engine refuses before it changes anything. `status` is the HTTP status the route answers with. */
export class MatchRefusedError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

interface Undo {
  label: string;
  run: () => Promise<void>;
}

interface Handle {
  plan: OverPlan;
  before: string | null;
  script: Promise<void>;
}

interface Run {
  fixture: MatchFixture;
  deck: Map<string, IncidentCard>;
  startedAt: number;
  stopRequested: boolean;
  scores: OverScore[];
  cardTitles: Record<string, string>;
  /** Bumped when an over ends or is abandoned, so a script waiting to fire for it knows not to. */
  overToken: number;
  currentOver: number | null;
  phase: MatchPhase | null;
  overStartedAt: number | null;
  overEndsAt: number | null;
  card: PlayedCard | null;
  undos: Undo[];
  result: (MatchResult & { text: string }) | null;
  done: Promise<void>;
}

const sleepReal = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
/** Longest an over may take beyond its own duration before the runner gives up on it. */
const OVER_GRACE_MS = 20_000;
const STOP_WAIT_MS = 8000;

export function publicFixture(f: MatchFixture): PublicFixture {
  return {
    seed: f.seed,
    date: f.date,
    wicketsInHand: f.wicketsInHand,
    overs: f.overs.map((o) => ({
      over: o.over,
      scenario: o.scenario,
      connections: o.connections,
      durationSec: o.durationSec,
      incident: o.cardId !== null,
      errorBudget: o.errorBudget,
      p99BudgetMs: o.p99BudgetMs,
    })),
  };
}

export class MatchRunner {
  private active: Run | null = null;
  private last: Run | null = null;
  private readonly now: () => number;
  private readonly sleep: (ms: number) => Promise<void>;

  constructor(private readonly d: RunnerDeps) {
    this.now = d.now ?? Date.now;
    this.sleep = d.sleep ?? sleepReal;
  }

  get busy(): boolean {
    return this.active !== null;
  }

  private emit(name: string, data: Record<string, unknown>): void {
    this.d.bus.emit('level.event', { kind: 'custom', name, data } satisfies LevelEventData);
  }

  private iso(ms: number | null): string | null {
    return ms === null ? null : new Date(ms).toISOString();
  }

  /**
   * Starts a match for `seed`. Over 1 never has a card, so the only thing done before the answer is to ask for its
   * traffic: if a level check or a load run is going, that is refused (409) and nothing has been changed.
   */
  async start(seed: number): Promise<MatchStatus> {
    if (this.active)
      throw new MatchRefusedError(409, 'match_in_progress', 'a match is already being played');
    if (!this.d.redis.isUp)
      throw new MatchRefusedError(
        409,
        'redis_down',
        'Redis is not reachable right now, so there is no match to play',
      );
    if (this.d.redis.kind !== 'single')
      throw new MatchRefusedError(
        409,
        'single_node_only',
        'Match Day plays on the single-node Redis target (a Sentinel or cluster target would make the incidents mean something else)',
      );
    const deck = await this.d.loadDeck();
    if (deck.cards.length === 0)
      throw new MatchRefusedError(
        503,
        'deck_unavailable',
        deck.errors.length > 0
          ? `the incident deck could not be loaded: ${deck.errors[0]?.file}: ${deck.errors[0]?.message}`
          : 'the incident deck is empty',
      );
    const fixture = buildFixture(seed, deck.cards.map(cardInfo));

    const run: Run = {
      fixture,
      deck: new Map(deck.cards.map((c) => [c.id, c])),
      startedAt: this.now(),
      stopRequested: false,
      scores: [],
      cardTitles: {},
      overToken: 0,
      currentOver: null,
      phase: null,
      overStartedAt: null,
      overEndsAt: null,
      card: null,
      undos: [],
      result: null,
      done: Promise.resolve(),
    };
    this.active = run; // a second start during the awaits below is refused

    let first: Handle;
    try {
      // A journal left by an engine that was cut off holds the player's real maxmemory: put it back first, so the
      // value this match journals later is the real one.
      await restoreMaxmemory(this.d.redis, this.d.journal).catch((err: Error) =>
        this.d.log?.warn({ err: err.message }, 'matchday: could not restore a leftover maxmemory'),
      );
      first = await this.beginOver(run, 1);
    } catch (err) {
      this.active = null;
      throw err;
    }
    this.emit('matchday_started', { seed, date: fixture.date });
    this.announceOver(first);
    run.done = this.loop(run, first);
    return this.status();
  }

  /** Resolves when the current (or last) match has fully ended and been put back. For tests and the check script. */
  async settled(): Promise<void> {
    const r = this.active ?? this.last;
    if (r) await r.done;
  }

  /** Ends the match early. `stopped` is true when there was one to stop. */
  async stop(): Promise<{ stopped: boolean }> {
    const run = this.active;
    if (!run) return { stopped: false };
    run.stopRequested = true;
    await this.d.load.stop().catch(() => undefined);
    let timer: NodeJS.Timeout | undefined;
    const giveUp = new Promise((r) => {
      timer = setTimeout(r, STOP_WAIT_MS);
    });
    await Promise.race([run.done, giveUp]);
    clearTimeout(timer);
    return { stopped: true };
  }

  // ---- one over --------------------------------------------------------------------------------

  private async beginOver(run: Run, n: number): Promise<Handle> {
    const plan = run.fixture.overs[n - 1] as OverPlan;
    run.currentOver = n;
    run.phase = 'card';
    run.card = null;
    try {
      const card = plan.cardId ? run.deck.get(plan.cardId) : undefined;
      // Not `await`ed: the script's promise is the over's blocking script, which has not even started yet.
      const { script } = card
        ? await this.playCard(run, plan, card)
        : { script: Promise.resolve() };
      const before = (await this.d.load.status()).last?.finishedAt ?? null;
      const out = await this.startTraffic(plan, n === 1 ? 0 : (this.d.retriesBetweenOvers ?? 8));
      if (!out.ok)
        throw new MatchRefusedError(
          out.status === 409 ? 409 : 502,
          out.status === 409 ? out.code : 'traffic_failed',
          out.status === 409
            ? 'a level check or a traffic run is going: Match Day waits for it to end'
            : `the over's traffic could not start: ${out.message}`,
        );
      run.phase = 'bowling';
      run.overStartedAt = this.now();
      run.overEndsAt = run.overStartedAt + plan.durationSec * 1000;
      return { plan, before, script };
    } catch (err) {
      run.overToken++;
      await this.undoAll(run);
      throw err;
    }
  }

  private announceOver(h: Handle): void {
    this.emit('matchday_over_started', {
      over: h.plan.over,
      scenario: h.plan.scenario,
      connections: h.plan.connections,
      cardId: h.plan.cardId,
    });
  }

  private async startTraffic(plan: OverPlan, retries: number): Promise<LoadStartOutcome> {
    let out = await this.d.load.start({
      scenario: plan.scenario,
      durationSec: plan.durationSec,
      connections: plan.connections,
    });
    for (let i = 0; !out.ok && out.status === 409 && i < retries; i++) {
      await this.sleep(500);
      out = await this.d.load.start({
        scenario: plan.scenario,
        durationSec: plan.durationSec,
        connections: plan.connections,
      });
    }
    return out;
  }

  /** Applies a card's steps. `script` is the promise of its blocking script (already resolved when it has none). */
  private async playCard(
    run: Run,
    plan: OverPlan,
    card: IncidentCard,
  ): Promise<{ script: Promise<void> }> {
    const played: PlayedCard = {
      id: card.id,
      title: card.title,
      sees: card.sees,
      causeSummary: card.cause.summary,
      ends: card.ends,
      facts: card.facts.map((f) => ({
        text: f.text,
        source: f.source,
        ...(f.ref ? { ref: f.ref } : {}),
      })),
      applied: [],
      skipped: [],
    };
    run.card = played;
    run.cardTitles[card.id] = card.title;
    let script: Promise<void> = Promise.resolve();
    for (const step of card.cause.steps) {
      switch (step.kind) {
        case 'switch_scenario':
          played.applied.push(`The over runs the ${plan.scenario} scenario`);
          break;
        case 'delete_keys': {
          const n = await deleteKeys(this.d.redis, step.prefixes);
          played.applied.push(
            `Deleted ${n} key${n === 1 ? '' : 's'} under ${step.prefixes.join(', ')}`,
          );
          break;
        }
        case 'lower_maxmemory': {
          const r = await lowerMaxmemory(this.d.redis, this.d.journal, step.headroomKb, () =>
            new Date(this.now()).toISOString(),
          );
          if (r.applied) {
            played.applied.push(r.note);
            run.undos.push({
              label: 'maxmemory',
              run: async () => void (await restoreMaxmemory(this.d.redis, this.d.journal)),
            });
          } else played.skipped.push(r.note);
          break;
        }
        case 'block_script':
          played.applied.push(
            `A counting script of ${step.iterations.toLocaleString('en-US')} steps, ${step.startAfterSec} s into the over, with no keys and no writes`,
          );
          script = this.blockLater(run, step.startAfterSec, step.iterations);
          break;
      }
    }
    this.emit('matchday_card', {
      over: plan.over,
      cardId: card.id,
      title: card.title,
      applied: played.applied,
      skipped: played.skipped,
    });
    return { script };
  }

  private async blockLater(run: Run, afterSec: number, iterations: number): Promise<void> {
    const token = run.overToken;
    const cancelled = () => run.stopRequested || run.overToken !== token;
    for (let waited = 0; waited < afterSec * 1000; waited += 250) {
      if (cancelled()) return;
      await this.sleep(250);
    }
    if (cancelled()) return;
    try {
      await runBlockScript(this.d.redis, iterations);
    } catch (err) {
      this.d.log?.warn(
        { err: (err as Error).message },
        'matchday: the blocking script did not finish cleanly',
      );
    }
  }

  private async finishOver(run: Run, h: Handle): Promise<OverScore | null> {
    run.phase = 'scoring';
    try {
      const deadline = this.now() + h.plan.durationSec * 1000 + OVER_GRACE_MS;
      for (;;) {
        const st = await this.d.load.status();
        if (!st.running) break;
        if (this.now() > deadline) {
          await this.d.load.stop().catch(() => undefined);
          throw new Error("the over's traffic did not end in time");
        }
        await this.sleep(this.d.pollMs ?? 500);
      }
      await h.script;
      if (run.stopRequested) return null;
      const last = (await this.d.load.status()).last;
      if (!last || last.finishedAt === h.before || last.scenario !== h.plan.scenario)
        throw new Error(`the traffic run of over ${h.plan.over} failed (see the engine log)`);
      return scoreOver(h.plan, {
        requests: last.requests,
        errors: last.errors,
        status5xx: last.status5xx,
        p99Ms: last.p99Ms,
        rps: last.rps,
      });
    } finally {
      run.overToken++;
      await this.undoAll(run);
    }
  }

  /** Runs every registered undo, newest first. Each is tried even if another fails. */
  private async undoAll(run: Run): Promise<void> {
    while (run.undos.length > 0) {
      const u = run.undos.pop() as Undo;
      try {
        await u.run();
      } catch (err) {
        this.d.log?.error(
          { err: (err as Error).message, undo: u.label },
          'matchday: an undo failed',
        );
      }
    }
  }

  // ---- the match -------------------------------------------------------------------------------

  private async loop(run: Run, first: Handle): Promise<void> {
    let endedBy: EndedBy = 'complete';
    let note: string | undefined;
    try {
      let handle = first;
      for (let n = 1; n <= OVERS; n++) {
        if (n > 1) {
          if (run.stopRequested) {
            endedBy = 'stopped';
            break;
          }
          handle = await this.beginOver(run, n);
          this.announceOver(handle);
        }
        const score = await this.finishOver(run, handle);
        if (score === null || run.stopRequested) {
          endedBy = 'stopped';
          break;
        }
        run.scores.push(score);
        this.emit('matchday_over', { ...score });
        if (innings(run.fixture, run.scores).allOut) {
          endedBy = 'all_out';
          break;
        }
      }
    } catch (err) {
      endedBy = 'error';
      note = (err as Error).message;
      this.d.log?.error({ err: note }, 'matchday: the match ended with an error');
    } finally {
      await this.finish(run, endedBy, note);
    }
  }

  private async finish(run: Run, endedBy: EndedBy, note?: string): Promise<void> {
    // Whatever happened above, nothing a card changed may outlive the match.
    await this.undoAll(run);
    await restoreMaxmemory(this.d.redis, this.d.journal).catch((err: Error) =>
      this.d.log?.error(
        { err: err.message },
        'matchday: maxmemory could not be put back; it will be tried again on the next connect',
      ),
    );
    const result = summarizeMatch(
      run.fixture,
      run.scores,
      endedBy,
      new Date(this.now()).toISOString(),
      note ?? (endedBy === 'stopped' ? 'You stopped the match.' : undefined),
    );
    const titleOf = (id: string) => run.cardTitles[id] ?? id;
    run.result = { ...result, text: scorecardText(result, titleOf) };
    run.phase = 'done';
    run.overEndsAt = null;
    run.card = null;
    try {
      await this.d.results.add(result);
    } catch (err) {
      this.d.log?.error({ err: (err as Error).message }, 'matchday: the result could not be saved');
    }
    this.last = run;
    this.active = null;
    this.emit('matchday_finished', {
      seed: result.seed,
      runs: result.runs,
      wickets: result.wickets,
      endedBy: result.endedBy,
    });
  }

  // ---- what the routes answer ------------------------------------------------------------------

  status(): MatchStatus {
    const run = this.active ?? this.last;
    const now = new Date(this.now()).toISOString();
    if (!run)
      return {
        state: 'idle',
        seed: null,
        date: null,
        wicketsInHand: 0,
        overs: [],
        currentOver: null,
        phase: null,
        overStartedAt: null,
        overEndsAt: null,
        card: null,
        cardTitles: {},
        scores: [],
        runs: 0,
        wickets: 0,
        result: null,
        now,
      };
    const inn = innings(run.fixture, run.scores);
    return {
      state: this.active === run ? 'running' : 'finished',
      seed: run.fixture.seed,
      date: run.fixture.date,
      wicketsInHand: run.fixture.wicketsInHand,
      overs: publicFixture(run.fixture).overs,
      currentOver: run.currentOver,
      phase: run.phase,
      overStartedAt: this.iso(run.overStartedAt),
      overEndsAt: this.iso(run.overEndsAt),
      card: run.card,
      cardTitles: { ...run.cardTitles },
      scores: [...run.scores],
      runs: inn.runs,
      wickets: inn.wickets,
      result: run.result,
      now,
    };
  }
}
