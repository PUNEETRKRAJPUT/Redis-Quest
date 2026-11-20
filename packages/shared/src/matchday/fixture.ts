// The fixture for a seed: which scenario each over runs, which incident card (if any) comes before it, and the
// budgets that decide whether a wicket falls. Pure: the same seed and the same deck always give the same match, on
// every machine, with no server. The date is the default seed, so everybody plays the same match on the same day.

import type { CardInfo } from './deck.js';
import { mulberry32, pick, randInt, shuffled } from './rng.js';

export const OVERS = 6;
export const OVER_SECONDS = 10;
export const WICKETS_IN_HAND = 3;
/** An over is lost a wicket when more than this share of attempts failed (5xx or no response). Chosen, not measured. */
export const ERROR_BUDGET = 0.01;
/** ... or when the 99th percentile is above this. Chosen, not measured; an over with an incident gets more room. */
export const P99_BUDGET_MS = 400;
export const P99_BUDGET_INCIDENT_MS = 800;
/** Concurrent connections per over: modest on purpose (a 16 GB Mac runs the whole stack), and the engine caps them again. */
export const CONNECTION_CHOICES: readonly number[] = [30, 40, 50, 60];
/** Scenarios an ordinary over may run. Each file lives in scenarios/; cards bring their own (celebrity-100, bad-id-hammer). */
export const MATCH_SCENARIOS: readonly string[] = [
  'toss-time-100',
  'stats-hot-100',
  'fixtures-read',
  'leaderboard-storm',
];

export interface OverPlan {
  /** 1-based. */
  over: number;
  scenario: string;
  connections: number;
  durationSec: number;
  /** The incident played before this over, or null. */
  cardId: string | null;
  errorBudget: number;
  p99BudgetMs: number;
}

export interface MatchFixture {
  version: 1;
  seed: number;
  /** The date the seed stands for when it came from a date (YYYY-MM-DD, UTC), else null. */
  date: string | null;
  wicketsInHand: number;
  overs: OverPlan[];
}

export const MAX_SEED = 2 ** 31 - 1;

/** The seed for a calendar day: YYYYMMDD of the UTC date, e.g. 20261120. */
export function seedForDate(d: Date): number {
  return d.getUTCFullYear() * 10000 + (d.getUTCMonth() + 1) * 100 + d.getUTCDate();
}

/** The date a YYYYMMDD seed stands for, or null when the number is not a real calendar date. */
export function dateForSeed(seed: number): string | null {
  if (!Number.isInteger(seed) || seed < 10000101 || seed > 99991231) return null;
  const y = Math.floor(seed / 10000);
  const m = Math.floor((seed % 10000) / 100);
  const day = seed % 100;
  const t = new Date(Date.UTC(y, m - 1, day));
  if (t.getUTCFullYear() !== y || t.getUTCMonth() !== m - 1 || t.getUTCDate() !== day) return null;
  return `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/** A whole number from 1 to MAX_SEED, or null. Numeric strings are accepted (a form field). */
export function parseSeed(v: unknown): number | null {
  const n = typeof v === 'string' && /^\d{1,10}$/.test(v.trim()) ? Number(v.trim()) : v;
  return typeof n === 'number' && Number.isInteger(n) && n >= 1 && n <= MAX_SEED ? n : null;
}

/**
 * Builds the match for `seed` from the deck's cards. Rules: over 1 never has a card (a match opens quiet, and the
 * engine learns there whether anything else is running before it changes anything); two or three of overs 2 to 6 do;
 * no card is played twice; no scenario runs twice in a row.
 */
export function buildFixture(seed: number, cards: readonly CardInfo[]): MatchFixture {
  const rng = mulberry32(seed);
  const deck = [...cards].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const wanted = 2 + randInt(rng, 2);
  const count = Math.min(wanted, deck.length);
  const slots = shuffled(rng, [2, 3, 4, 5, 6])
    .slice(0, count)
    .sort((a, b) => a - b);
  const hand = shuffled(rng, deck).slice(0, count);
  const cardAt = new Map<number, CardInfo>();
  slots.forEach((over, i) => {
    const c = hand[i];
    if (c) cardAt.set(over, c);
  });

  const overs: OverPlan[] = [];
  let previous = '';
  for (let over = 1; over <= OVERS; over++) {
    const card = cardAt.get(over) ?? null;
    const scenario =
      card?.scenario ??
      pick(
        rng,
        MATCH_SCENARIOS.filter((s) => s !== previous),
      );
    previous = scenario;
    overs.push({
      over,
      scenario,
      connections: pick(rng, CONNECTION_CHOICES),
      durationSec: OVER_SECONDS,
      cardId: card ? card.id : null,
      errorBudget: ERROR_BUDGET,
      p99BudgetMs: card ? P99_BUDGET_INCIDENT_MS : P99_BUDGET_MS,
    });
  }
  return { version: 1, seed, date: dateForSeed(seed), wicketsInHand: WICKETS_IN_HAND, overs };
}
