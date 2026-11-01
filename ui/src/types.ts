// Shapes of the engine API, copied from docs/handoffs/P0-06.md. Only what the UI reads.

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
  levels: { id: string; title: string; mode: Mode; xp: number; status: LevelStatus; attempts: number }[];
}

export interface ChaptersResponse {
  player: { id: string; name: string } | null;
  xp: number;
  chapters: ChapterSummary[];
}

export type VerifierInfo =
  | { index: number; type: 'quiz'; question: string; options: { id: string; label: string }[]; multiple: boolean }
  | { index: number; type: 'answer'; prompt: string }
  | { index: number; type: string };

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
  showMe: string | null;
  scenario: string | null;
  minRedisVersion: string | null;
  reward: { xp: number; badge?: string };
  status: LevelStatus;
  attempts: number;
  brainstormAnswer: { optionId: string; text: string; at: string } | null;
  startedAt: string | null;
  completedAt: string | null;
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
  /** Optional, not documented by the engine yet: the ideal-way panel renders these when present. */
  ideal?: IdealWayPayload;
  [extra: string]: unknown;
}

export interface IdealWayPayload {
  reference?: string;
  language?: string;
  annotations?: string;
  tradeoffs?: string[];
}

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
