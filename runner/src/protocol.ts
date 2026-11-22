import type { LearnerCallResult, LearnerError, LearnerMetrics } from '@quest/shared';

/** Parent -> child, sent once over IPC. */
export interface ChildJob {
  mode: 'run' | 'load';
  workspaceDir: string;
  module: string;
  exportName: string;
  calls: Array<{ args?: unknown[] }>;
  concurrency: number;
  timeoutMs: number;
  redisUrl?: string;
  databaseUrl?: string;
}

/**
 * Child -> parent, sent once in a `run` job just before the first call into learner code (never in `load` mode).
 * The parent restarts its hard-kill clock on it, so the time the child spent booting, connecting and importing is
 * not taken out of the learner's own budget.
 */
export interface ChildStarted {
  started: true;
}

export function isChildStarted(m: unknown): m is ChildStarted {
  return typeof m === 'object' && m !== null && (m as { started?: unknown }).started === true;
}

/** Child -> parent, sent once over IPC just before the child exits. */
export type ChildReply =
  | { mode: 'load'; ok: boolean; exports: string[]; error?: LearnerError; logs: string[] }
  | { mode: 'run'; results: LearnerCallResult[]; metrics: LearnerMetrics; logs: string[] };
