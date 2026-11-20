// The pure parts of the Match Day screen: seeds typed by a player, the live numbers out of the store's metric
// ticks, the countdown against the engine's clock, the scoreboard rows, and the words for a refused start.

import { ApiError } from '@/api';
import type { MetricsTick } from '@/types';
import type { MatchStatus, OverScore } from './types';

export const MAX_SEED = 2 ** 31 - 1;

export function randomSeed(random: () => number = Math.random): number {
  return Math.floor(random() * (MAX_SEED - 1)) + 1;
}

/** A seed typed into the form: whole numbers from 1 to 2147483647, nothing else. */
export function parseSeedInput(text: string): number | null {
  const t = text.trim();
  if (!/^\d{1,10}$/.test(t)) return null;
  const n = Number(t);
  return n >= 1 && n <= MAX_SEED ? n : null;
}

/** A metric tick's time in milliseconds (the engine sends seconds or milliseconds, or an ISO string). */
export function tickMs(at: number | string): number {
  if (typeof at === 'string') {
    const t = Date.parse(at);
    return Number.isNaN(t) ? 0 : t;
  }
  return at < 1e12 ? at * 1000 : at;
}

export interface LiveFigures {
  /** Requests per second over the last few ticks; null when the app has served nothing lately. */
  rps: number | null;
  /** The worst 99th percentile among those ticks, in ms. */
  p99Ms: number | null;
  errors: number;
}

/** The war room's two numbers, from the ticks the store already holds (one per second while the app serves). */
export function liveFigures(
  ticks: readonly MetricsTick[],
  nowMs: number,
  windowSec = 3,
): LiveFigures {
  const recent = ticks.filter((t) => {
    const at = tickMs(t.at);
    return at > nowMs - windowSec * 1000 - 1000 && at <= nowMs + 2000;
  });
  if (recent.length === 0) return { rps: null, p99Ms: null, errors: 0 };
  const total = recent.reduce((s, t) => s + t.count, 0);
  return {
    rps: Math.round(total / recent.length),
    p99Ms: Math.round(Math.max(...recent.map((t) => t.p99Ms))),
    errors: recent.reduce((s, t) => s + t.errors, 0),
  };
}

/**
 * Whole seconds left in the over, read against the engine's clock: `engineNow` was the engine's time when the
 * status arrived (at `fetchedAtMs` on this machine), so a wrong local clock does not skew the countdown.
 */
export function secondsLeft(
  overEndsAt: string | null,
  engineNow: string,
  fetchedAtMs: number,
  localNowMs: number,
): number | null {
  if (!overEndsAt) return null;
  const end = Date.parse(overEndsAt);
  const eng = Date.parse(engineNow);
  if (Number.isNaN(end) || Number.isNaN(eng)) return null;
  const engineEstimate = eng + (localNowMs - fetchedAtMs);
  return Math.max(0, Math.ceil((end - engineEstimate) / 1000));
}

export type RowState = 'done' | 'current' | 'upcoming' | 'not_bowled';

export interface BoardRow {
  over: number;
  scenario: string;
  incident: boolean;
  /** The incident's name once it has been played; until then it stays hidden. */
  cardTitle: string | null;
  state: RowState;
  score: OverScore | null;
  p99BudgetMs: number;
  errorBudget: number;
}

export function boardRows(st: MatchStatus): BoardRow[] {
  return st.overs.map((o) => {
    const score = st.scores.find((s) => s.over === o.over) ?? null;
    const isCurrent = st.state === 'running' && st.currentOver === o.over && score === null;
    const state: RowState = score
      ? 'done'
      : isCurrent
        ? 'current'
        : st.state === 'finished'
          ? 'not_bowled'
          : 'upcoming';
    const cardId = score?.cardId ?? (isCurrent ? (st.card?.id ?? null) : null);
    return {
      over: o.over,
      scenario: o.scenario,
      incident: o.incident,
      cardTitle: cardId ? (st.cardTitles[cardId] ?? null) : null,
      state,
      score,
      p99BudgetMs: o.p99BudgetMs,
      errorBudget: o.errorBudget,
    };
  });
}

export const PHASE_LABEL: Record<NonNullable<MatchStatus['phase']>, string> = {
  card: 'Incident card',
  bowling: 'Bowling',
  scoring: 'Scoring the over',
  done: 'Finished',
};

export const ENDED_LABEL = {
  complete: 'Innings complete',
  all_out: 'All out',
  stopped: 'Stopped early',
  error: 'Ended by an error',
} as const;

/** Plain words for a refused or failed start, from the engine's error code. */
export function startErrorCopy(err: unknown): string {
  if (err instanceof ApiError) {
    switch (err.code) {
      case 'verify_in_progress':
        return 'A level check or a traffic run is going. Wait for it to end, then try again.';
      case 'match_in_progress':
        return 'A match is already being played.';
      case 'redis_down':
        return 'Redis is not reachable right now, so there is no match to play. Start it and try again.';
      case 'single_node_only':
        return 'Match Day plays on the single-node Redis target. Switch the target back and try again.';
      case 'deck_unavailable':
        return `The incident deck could not be loaded. ${err.message}`;
      case 'offline':
        return err.message;
      default:
        return err.message;
    }
  }
  return err instanceof Error ? err.message : 'The match could not start.';
}

export function formatPercent(share: number): string {
  return `${(share * 100).toFixed(1)}%`;
}
