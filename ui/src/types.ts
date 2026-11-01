// Shapes of the engine API, copied from docs/handoffs/P0-06.md. Only what the UI reads.

/** `show_me` as the loader normalises it: always an object. Keys may still carry `{{player.id}}` (see showme/index.tsx). */
export interface ShowMeSpec {
  component: string;
  keys: string[];
  title?: string;
}

export type LevelStatus = 'locked' | 'available' | 'in_progress' | 'passed';
export type Mode = 'cli' | 'code' | 'ops' | 'decision';
export type Verdict = 'right' | 'works_but_wrong' | 'wrong' | 'not_implemented';

export interface ProgressLevel {
  status: LevelStatus;
  attempts: number;
  verdicts: { at: string; verdict: Verdict }[];
  brainstorm?: { optionId: string; text: string; at: string };
  completedAt?: string;
  startedAt?: string;
  hintsRevealed?: number;
  /** F-12, interview levels only. */
  interviewStartedAt?: string;
  hintsBought?: number;
  interviewElapsedMs?: number;
  overtime?: boolean;
}

export interface Progress {
  version: 1;
  player: { id: string; name: string; createdAt: string };
  target: { redisUrl: string };
  activeSlots: string[];
  levels: Record<string, ProgressLevel | undefined>;
  xp: number;
  badges: string[];
}

export interface ThreadMessage {
  from: string;
  time: string;
  text: string;
}

export interface ChapterSummary {
  id: string;
  dirName: string;
  title: string;
  incident: ThreadMessage[];
  levels: {
    id: string;
    title: string;
    mode: Mode;
    xp: number;
    status: LevelStatus;
    attempts: number;
  }[];
}

export interface ChaptersResponse {
  player: { id: string; name: string } | null;
  xp: number;
  chapters: ChapterSummary[];
}

export type VerifierInfo =
  | {
      index: number;
      type: 'quiz';
      question: string;
      options: { id: string; label: string }[];
      multiple: boolean;
    }
  | { index: number; type: 'answer'; prompt: string }
  | { index: number; type: string };

/** F-12: `interview` of GET /api/levels/:id (null on an ordinary level); `remainingMs` is its sibling. */
export interface InterviewInfo {
  minutes: number;
  hintXpCost: number;
  rebuildOf: { id: string; title: string | null };
  startedAt: string | null;
  deadlineAt: string | null;
  overtime: boolean;
  /** Past the deadline by this much when the response was made (or when the level was passed). */
  overtimeMs: number;
  hintsBought: number;
  /** Set once passed: the time it took. */
  elapsedMs: number | null;
}

export interface LevelData {
  id: string;
  chapter: string;
  chapterTitle: string;
  title: string;
  mode: Mode;
  story: string;
  teach: string;
  task: string;
  brainstorm: { prompt: string; options: { id: string; label: string; is_reasonable: boolean }[] };
  hints: string[];
  hintsTotal: number;
  verifiers: VerifierInfo[];
  docs: string[];
  showMe: ShowMeSpec | null;
  scenario: string | null;
  minRedisVersion: string | null;
  reward: { xp: number; badge?: string };
  status: LevelStatus;
  attempts: number;
  brainstormAnswer: { optionId: string; text: string; at: string } | null;
  startedAt: string | null;
  completedAt: string | null;
  interview: InterviewInfo | null;
  /** Milliseconds left on the interview clock when the response was made; null on other levels or before the start. */
  remainingMs: number | null;
}

/** One entry of `checks` in the verify response (P0-09 spec). Everything but `ok` is optional for safety. */
export interface CheckResult {
  index: number;
  type?: string;
  ok: boolean;
  message?: string;
  details?: unknown;
}

export interface VerifyResponse {
  verdict: Verdict;
  attempts: number;
  status: LevelStatus;
  checks?: CheckResult[];
  durationMs?: number;
  feedback?: string;
  metrics?: Record<string, unknown>;
  /** Present when the engine allows the ideal way (passed, or 3 attempts). Shape: docs/handoffs/P0-09.md. */
  ideal?: Ideal;
  /** Interview levels only: the deadline had passed when the verify was asked for, and the time since the start. */
  overtime?: boolean;
  elapsedMs?: number | null;
  [extra: string]: unknown;
}

export interface IdealFile {
  path: string;
  content: string;
}

export type Ideal =
  | {
      mode: 'cli' | 'code' | 'ops';
      reference: IdealFile;
      wrong: Array<IdealFile & { expect: 'wrong' | 'works_but_wrong'; because: string }>;
      reasoning: string;
    }
  | {
      mode: 'decision';
      reference: { options: string[] };
      quizzes: Array<{ index: number; question: string; correct: string[]; explanation: string }>;
      wrong: Array<{ option: string; expect: 'wrong'; because: string }>;
      reasoning: string;
    };

export type IdealResponse = Ideal & { allowed: boolean; reason: string };

export interface CliReply {
  reply: string;
  type: 'integer' | 'bulk' | 'status' | 'nil' | 'array' | 'error';
  ms: number;
}

export interface MetricsTick {
  at: number | string;
  instances?: string[];
  count: number;
  errors: number;
  p50Ms: number;
  p99Ms: number;
  routes?: Record<string, Record<string, number>>;
}

export interface MetricsSeries {
  windowSeconds: number;
  instances: string[];
  totals: { count: number; errors: number; p50Ms: number; p99Ms: number; rps: number };
  routes: Record<string, { count: number; errors: number; p50Ms: number; p99Ms: number }>;
  series: { at: number | string; count: number; errors: number; p50Ms: number; p99Ms: number }[];
}

export interface Health {
  ok: boolean;
  service: string;
  redis: 'up' | 'down';
  postgres: 'up' | 'down';
  boots: number | null;
  levels: 'ok' | 'error';
  /** Served by the engine (F-09): http://<request host>:<INSIGHT_PORT>. The Insight link uses it as is. */
  insightUrl?: string;
}

export interface MirrorStatus {
  redis: 'up' | 'down';
  present: boolean;
  inSync: boolean;
  expectedLevels: number;
  mirroredLevels: number;
}

export interface WorkspaceEntry {
  path: string;
  type: 'file' | 'dir';
  size?: number;
  editable?: boolean;
}

export type LogService = 'app' | 'runner' | 'proxy' | 'postgres';
export const LOG_SERVICES: LogService[] = ['app', 'runner', 'proxy', 'postgres'];

export interface WsMessage {
  type: string;
  at: string;
  data: Record<string, unknown>;
}

export interface LevelEventMsg {
  seq: number;
  at: string;
  kind: string;
  name?: string;
  data?: unknown;
}
