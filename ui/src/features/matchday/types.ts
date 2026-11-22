// What GET /api/matchday, POST /api/matchday/start and GET /api/matchday/status answer with. A copy of
// engine/src/matchday/types.ts (and the scoring types of packages/shared/src/matchday/score.ts): the UI does not
// import the engine or the shared package, so a change there is a change here.

export interface OverScore {
  over: number;
  scenario: string;
  cardId: string | null;
  requests: number;
  errors: number;
  p99Ms: number;
  rps: number;
  answeredShare: number;
  errorShare: number;
  runs: number;
  wicket: boolean;
  why: string[];
}

export type EndedBy = 'complete' | 'all_out' | 'stopped' | 'error';

export interface MatchResult {
  version: 1;
  seed: number;
  date: string | null;
  finishedAt: string;
  endedBy: EndedBy;
  runs: number;
  wickets: number;
  oversBowled: number;
  overs: OverScore[];
  note?: string;
}

export interface ResultsFile {
  version: 1;
  best: MatchResult[];
  bySeed: Record<string, MatchResult>;
  recent: MatchResult[];
}

export interface PublicOver {
  over: number;
  scenario: string;
  connections: number;
  durationSec: number;
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

export interface PlayedCard {
  id: string;
  title: string;
  sees: string;
  causeSummary: string;
  ends: string;
  facts: PlayedFact[];
  applied: string[];
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
  cardTitles: Record<string, string>;
  scores: OverScore[];
  runs: number;
  wickets: number;
  result: (MatchResult & { text: string }) | null;
  now: string;
}

export interface MatchdayOverview {
  today: { seed: number; date: string };
  fixture: PublicFixture;
  results: ResultsFile;
  bestForSeed: MatchResult | null;
  canStart: { ok: boolean; reason: string | null };
  deckErrors: string[];
  machineNote: string;
  caps: { maxConnections: number; maxDurationSec: number; lowPower: boolean };
}
