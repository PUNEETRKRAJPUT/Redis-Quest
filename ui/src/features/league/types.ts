// The shapes of GET /api/league and POST /api/league/score (engine/src/features/league.ts). The UI does not import
// @quest/shared, so they are written out here.

export interface LeagueCheck {
  cmd: string;
  /** What the check has to answer: `12`, `between 55 and 60`, `nil`. */
  expected: string;
  message?: string;
}

/** A committed entry once it has been scored. */
export interface BoardEntry {
  handle: string;
  rank: number;
  commands: number;
  bytes: number;
  chars: number;
  /** Positive: that many commands under par. */
  underPar: number;
}

/** A committed entry when scoring was not possible: only what can be read without Redis. */
export interface PlainEntry {
  handle: string;
  commands: number;
}

export interface LeagueHole {
  id: string;
  title: string;
  /** Markdown. */
  task: string;
  par: number;
  setup: string[];
  checks: LeagueCheck[];
  entries: (BoardEntry | PlainEntry)[];
  failed: { handle: string; message: string }[];
}

export interface LeagueResponse {
  available: boolean;
  db: number;
  scored: boolean;
  /** Why the board has no scores (cluster target, Redis down, ...). */
  unscored?: string;
  /** Files in golf/ that did not load, as `file:line:col path: message`. */
  problems: string[];
  holes: LeagueHole[];
}

export interface CheckOutcome {
  cmd: string;
  ok: boolean;
  expected: string;
  observed: string;
  feedback: string;
}

export type ScoreResult =
  | {
      ok: true;
      holeId: string;
      handle: string;
      commands: number;
      bytes: number;
      chars: number;
      par: number;
      underPar: number;
      checks: CheckOutcome[];
    }
  | {
      ok: false;
      holeId: string;
      handle: string;
      reason:
        | 'refused'
        | 'not_scratch'
        | 'runner_failed'
        | 'setup_failed'
        | 'command_failed'
        | 'checks_failed';
      message: string;
      line?: number;
      checks: CheckOutcome[];
    };

export interface AttemptRank {
  position: number;
  of: number;
  tiedWith: string[];
  best?: { handle: string; commands: number; bytes: number; chars: number };
}

export interface ScoreResponse {
  result: ScoreResult;
  rank: AttemptRank | null;
  committed: number;
}

/** What "Score it" came back with, in the four shapes the screen shows. */
export type ScoreOutcome =
  | { kind: 'scored'; data: ScoreResponse }
  | { kind: 'invalid'; problems: { line: number; col: number; message: string }[] }
  | { kind: 'refused'; error: string; message: string }
  | { kind: 'offline'; message: string };
