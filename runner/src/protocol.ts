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

/** Child -> parent, sent once over IPC just before the child exits. */
export type ChildReply =
  | { mode: 'load'; ok: boolean; exports: string[]; error?: LearnerError; logs: string[] }
  | { mode: 'run'; results: LearnerCallResult[]; metrics: LearnerMetrics; logs: string[] };
