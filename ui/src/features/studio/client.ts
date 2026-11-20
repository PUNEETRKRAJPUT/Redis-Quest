import { ApiError } from '../../api';
import type { Draft } from './draft';

export interface DraftError {
  file: string;
  line: number;
  col: number;
  path: string;
  message: string;
  text: string;
}
export interface DraftProblem {
  path: string;
  message: string;
}
export interface DraftFile {
  path: string;
  content: string;
}
export interface Validation {
  ok: boolean;
  id: string | null;
  directory: string | null;
  files: DraftFile[];
  problems: DraftProblem[];
  errors: DraftError[];
}
export interface PlaytestCheck {
  index: number;
  type?: string;
  ok: boolean;
  message?: string;
  details?: unknown;
}
export interface PlaytestRun {
  name: string;
  expect: 'right' | 'wrong' | 'works_but_wrong';
  because?: string;
  verdict: 'right' | 'wrong' | 'works_but_wrong';
  ok: boolean;
  transcript: { line: string; reply: string; type: string; ms: number }[];
  outcome: {
    verdict: 'right' | 'wrong' | 'works_but_wrong';
    checks: PlaytestCheck[];
    durationMs: number;
  };
}
export interface Playtest {
  passed: boolean;
  refused: string | null;
  keys: string[];
  runs: PlaytestRun[];
  validation: Validation;
}

async function post<T>(path: string, body: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
  } catch {
    throw new ApiError(0, 'offline', 'Cannot reach the game engine. Is the stack running?');
  }
  const text = await res.text();
  let json: Record<string, unknown> = {};
  try {
    json = text ? (JSON.parse(text) as Record<string, unknown>) : {};
  } catch {
    if (!res.ok)
      throw new ApiError(
        res.status,
        'bad_gateway',
        `The engine answered ${res.status}. It may still be starting.`,
      );
  }
  if (!res.ok)
    throw new ApiError(
      res.status,
      String(json.error ?? 'error'),
      String(json.message ?? `HTTP ${res.status}`),
      json,
    );
  return json as T;
}

export const studioApi = {
  validate: (draft: Draft) => post<Validation>('/api/studio/validate', { draft }),
  playtest: (draft: Draft) => post<Playtest>('/api/studio/playtest', { draft }),
};
