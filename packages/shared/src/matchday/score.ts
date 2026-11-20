// Scoring a match. An over scores runs from the share of attempts answered without error and loses a wicket when
// the error share or the 99th percentile crosses the budget the fixture states. Scores are for the player's own
// machine and own build: nothing here compares one machine with another.

import type { MatchFixture, OverPlan } from './fixture.js';

export const MAX_RUNS_PER_OVER = 36;

export const MACHINE_NOTE =
  "These scores are for your own machine and your own build. Compare them with your own earlier matches, not with other people's.";

/** What one over's load run reports (the engine's `last` run: responses, 5xx, no-response errors, p99). */
export interface OverMeasurement {
  /** Completed responses of any status. A 404 or 429 is an answer. */
  requests: number;
  /** 5xx plus requests that got no response at all. */
  errors: number;
  /** The 5xx part of `errors`. */
  status5xx: number;
  p99Ms: number;
  rps: number;
}

export interface OverScore {
  over: number;
  scenario: string;
  cardId: string | null;
  requests: number;
  errors: number;
  p99Ms: number;
  rps: number;
  /** Answered without error, over all attempts, 0 to 1. */
  answeredShare: number;
  errorShare: number;
  runs: number;
  wicket: boolean;
  /** Why the wicket fell, in words; empty when none did. */
  why: string[];
}

const round4 = (n: number) => Math.round(n * 10000) / 10000;

export function scoreOver(plan: OverPlan, m: OverMeasurement): OverScore {
  const noResponse = Math.max(0, m.errors - m.status5xx);
  const attempts = m.requests + noResponse;
  const answered = Math.max(0, m.requests - m.status5xx);
  const answeredShare = attempts === 0 ? 0 : answered / attempts;
  const errorShare = attempts === 0 ? 1 : m.errors / attempts;
  const why: string[] = [];
  if (attempts === 0) why.push('no request was answered');
  else if (errorShare > plan.errorBudget)
    why.push(
      `${(errorShare * 100).toFixed(1)}% of requests failed (budget ${(plan.errorBudget * 100).toFixed(1)}%)`,
    );
  if (attempts > 0 && m.p99Ms > plan.p99BudgetMs)
    why.push(`99th percentile ${Math.round(m.p99Ms)} ms (budget ${plan.p99BudgetMs} ms)`);
  return {
    over: plan.over,
    scenario: plan.scenario,
    cardId: plan.cardId,
    requests: m.requests,
    errors: m.errors,
    p99Ms: m.p99Ms,
    rps: m.rps,
    answeredShare: round4(answeredShare),
    errorShare: round4(errorShare),
    runs: Math.min(MAX_RUNS_PER_OVER, Math.max(0, Math.round(MAX_RUNS_PER_OVER * answeredShare))),
    wicket: why.length > 0,
    why,
  };
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
  /** When endedBy is stopped or error: one line saying why. */
  note?: string;
}

export function summarizeMatch(
  fixture: Pick<MatchFixture, 'seed' | 'date'>,
  overs: readonly OverScore[],
  endedBy: EndedBy,
  finishedAt: string,
  note?: string,
): MatchResult {
  return {
    version: 1,
    seed: fixture.seed,
    date: fixture.date,
    finishedAt,
    endedBy,
    runs: overs.reduce((s, o) => s + o.runs, 0),
    wickets: overs.filter((o) => o.wicket).length,
    oversBowled: overs.length,
    overs: [...overs],
    ...(note ? { note } : {}),
  };
}

/** Running totals after the overs scored so far, and whether the innings is over. */
export function innings(
  fixture: Pick<MatchFixture, 'wicketsInHand' | 'overs'>,
  overs: readonly OverScore[],
): { runs: number; wickets: number; allOut: boolean; finished: boolean } {
  const wickets = overs.filter((o) => o.wicket).length;
  const allOut = wickets >= fixture.wicketsInHand;
  return {
    runs: overs.reduce((s, o) => s + o.runs, 0),
    wickets,
    allOut,
    finished: allOut || overs.length >= fixture.overs.length,
  };
}

// ---- the results file --------------------------------------------------------------------------

export const BEST_KEPT = 5;
export const RECENT_KEPT = 10;

export interface ResultsFile {
  version: 1;
  /** The best finished matches overall, best first. */
  best: MatchResult[];
  /** The best finished match for each seed. */
  bySeed: Record<string, MatchResult>;
  /** The last matches, newest first, however they ended. */
  recent: MatchResult[];
}

export function emptyResults(): ResultsFile {
  return { version: 1, best: [], bySeed: {}, recent: [] };
}

/** Higher runs first, then fewer wickets, then the earlier match. */
export function compareResults(a: MatchResult, b: MatchResult): number {
  return (
    b.runs - a.runs ||
    a.wickets - b.wickets ||
    (a.finishedAt < b.finishedAt ? -1 : a.finishedAt > b.finishedAt ? 1 : 0)
  );
}

const counts = (r: MatchResult) => r.endedBy === 'complete' || r.endedBy === 'all_out';

/** Returns a new results file with `r` recorded. A match that was stopped or failed is only kept in `recent`. */
export function addResult(file: ResultsFile, r: MatchResult): ResultsFile {
  const recent = [r, ...file.recent].slice(0, RECENT_KEPT);
  if (!counts(r)) return { ...file, recent };
  const key = String(r.seed);
  const prev = file.bySeed[key];
  const bySeed = { ...file.bySeed, [key]: prev && compareResults(prev, r) <= 0 ? prev : r };
  const best = [...file.best, r].sort(compareResults).slice(0, BEST_KEPT);
  return { version: 1, best, bySeed, recent };
}

/** Reads whatever was on disk into a valid file; anything unexpected becomes an empty file. */
export function coerceResults(raw: unknown): ResultsFile {
  if (!raw || typeof raw !== 'object') return emptyResults();
  const o = raw as Partial<ResultsFile>;
  if (
    o.version !== 1 ||
    !Array.isArray(o.best) ||
    !Array.isArray(o.recent) ||
    !o.bySeed ||
    typeof o.bySeed !== 'object'
  )
    return emptyResults();
  return { version: 1, best: o.best, bySeed: o.bySeed, recent: o.recent };
}

// ---- the scorecard as text ---------------------------------------------------------------------

/** "142/2 after 6 overs". */
export function totalLine(r: Pick<MatchResult, 'runs' | 'wickets' | 'oversBowled'>): string {
  return `${r.runs}/${r.wickets} after ${r.oversBowled} over${r.oversBowled === 1 ? '' : 's'}`;
}

const ENDED_TEXT: Record<EndedBy, string> = {
  complete: 'Innings complete.',
  all_out: 'All out.',
  stopped: 'Stopped early.',
  error: 'Ended by an error.',
};

/** The cricket-form scorecard, plain ASCII, for the "copy as text" button. */
export function scorecardText(
  r: MatchResult,
  titleOf: (cardId: string) => string = (id) => id,
): string {
  const lines: string[] = [];
  lines.push(`Redis Quest Match Day, seed ${r.seed}${r.date ? ` (${r.date})` : ''}`);
  lines.push('');
  for (const o of r.overs) {
    const card = o.cardId ? `  incident: ${titleOf(o.cardId)}` : '';
    lines.push(
      `Over ${o.over}  ${o.scenario.padEnd(18)} ${String(o.runs).padStart(2)} runs${o.wicket ? '  W' : '   '}  p99 ${Math.round(o.p99Ms)} ms  errors ${(o.errorShare * 100).toFixed(1)}%${card}`,
    );
    for (const w of o.why) lines.push(`        wicket: ${w}`);
  }
  lines.push('');
  lines.push(`Total ${totalLine(r)}. ${ENDED_TEXT[r.endedBy]}${r.note ? ` ${r.note}` : ''}`);
  lines.push(MACHINE_NOTE);
  return lines.join('\n');
}
