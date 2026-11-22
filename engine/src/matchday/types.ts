// The shapes Match Day's routes answer with. The UI keeps its own copy (ui/src/features/matchday/types.ts): it does
// not depend on the engine or the shared package, so a change here is a change there.

import type { MatchResult, OverScore, ResultsFile } from '@quest/shared';

/** One over as the player may see it before it is played: the scenario, the size, whether an incident comes first. */
export interface PublicOver {
  over: number;
  scenario: string;
  connections: number;
  durationSec: number;
  /** True when an incident card is played before this over. Which card stays hidden until it is played. */
  incident: boolean;
  errorBudget: number;
  p99BudgetMs: number;
}

export interface PublicFixture {
  seed: number;
  date: string | null;
  wicketsInHand: number;
  overs: PublicOver[];
}

export interface PlayedFact {
  text: string;
  source: 'digest' | 'measured' | 'simulation';
  ref?: string;
}

/** The card of the over being bowled (or the last one bowled). */
export interface PlayedCard {
  id: string;
  title: string;
  sees: string;
  causeSummary: string;
  ends: string;
  facts: PlayedFact[];
  /** What the engine did, one line each, e.g. "Deleted 14 keys under cache:player:". */
  applied: string[];
  /** What it did not do and why (the maxmemory step is skipped unless the policy is noeviction). */
  skipped: string[];
}

export type MatchPhase = 'card' | 'bowling' | 'scoring' | 'done';

export interface MatchStatus {
  state: 'idle' | 'running' | 'finished';
  seed: number | null;
  date: string | null;
  wicketsInHand: number;
  overs: PublicOver[];
  currentOver: number | null;
  phase: MatchPhase | null;
  overStartedAt: string | null;
  overEndsAt: string | null;
  card: PlayedCard | null;
  /** Titles of the incidents played so far, by card id, so the scoreboard can name them. */
  cardTitles: Record<string, string>;
  scores: OverScore[];
  runs: number;
  wickets: number;
  /** Set once the match has ended: the result and the scorecard as plain text. */
  result: (MatchResult & { text: string }) | null;
  /** Engine clock, so a countdown does not trust the browser's clock. */
  now: string;
}

export interface MatchdayOverview {
  today: { seed: number; date: string };
  fixture: PublicFixture;
  /** Best finished matches, the best for this seed, the last few. */
  results: ResultsFile;
  bestForSeed: MatchResult | null;
  canStart: { ok: boolean; reason: string | null };
  deckErrors: string[];
  /** Said on every screen that shows a score. */
  machineNote: string;
  caps: { maxConnections: number; maxDurationSec: number; lowPower: boolean };
}
