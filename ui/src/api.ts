import type {
  ChaptersResponse,
  CliReply,
  Health,
  IdealResponse,
  LevelData,
  LoadStartResponse,
  LoadStatus,
  LogService,
  MetricsSeries,
  MirrorStatus,
  PortfolioResponse,
  PortfolioWriteResponse,
  Progress,
  TargetInfo,
  VerifyResponse,
  WorkspaceEntry,
} from './types';

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public body: Record<string, unknown> = {},
  ) {
    super(message);
  }
}

async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, {
      method,
      headers: body === undefined ? undefined : { 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new ApiError(0, 'offline', 'Cannot reach the game engine. Is the stack running?');
  }
  const text = await res.text();
  let json: Record<string, unknown> = {};
  try {
    json = text ? (JSON.parse(text) as Record<string, unknown>) : {};
  } catch {
    // A non-JSON body is almost always the proxy answering 502 while the engine boots.
    if (!res.ok)
      throw new ApiError(
        res.status,
        'bad_gateway',
        `The engine answered ${res.status}. It may still be starting.`,
      );
  }
  if (!res.ok) {
    throw new ApiError(
      res.status,
      String(json.error ?? 'error'),
      String(json.message ?? `HTTP ${res.status}`),
      json,
    );
  }
  return json as T;
}

const enc = encodeURIComponent;

export const api = {
  health: () => call<Health>('GET', '/health'),
  progress: () => call<Progress>('GET', '/api/progress'),
  mirror: () => call<MirrorStatus>('GET', '/api/progress/mirror'),
  restore: () =>
    call<{ ok: boolean; restored: boolean; levels: number }>('POST', '/api/progress/restore', {}),
  createPlayer: (name: string) => call<Progress>('POST', '/api/player', { name }),
  chapters: () => call<ChaptersResponse>('GET', '/api/chapters'),
  level: (id: string) => call<LevelData>('GET', `/api/levels/${enc(id)}`),
  start: (id: string) =>
    call<{ status: string; startedAt: string; setup: { ran: number; skipped: unknown[] } }>(
      'POST',
      `/api/levels/${enc(id)}/start`,
      {},
    ),
  brainstorm: (id: string, optionId: string, text: string) =>
    call<{ brainstorm: { optionId: string; text: string; at: string }; isReasonable: boolean }>(
      'POST',
      `/api/levels/${enc(id)}/brainstorm`,
      { optionId, text },
    ),
  hint: (id: string) =>
    call<{
      index: number;
      hint: string;
      revealed: number;
      hintsTotal: number;
      /** Interview levels only: XP actually taken, XP left, hints bought so far. */
      xpCost?: number;
      xp?: number;
      hintsBought?: number;
    }>('POST', `/api/levels/${enc(id)}/hint`, {}),
  verify: (id: string, answers: Record<string, string | string[]>) =>
    call<VerifyResponse>('POST', `/api/levels/${enc(id)}/verify`, { answers }),
  setSlots: (id: string, active: boolean) =>
    call<{ active: string[]; own: string[] }>('POST', `/api/levels/${enc(id)}/slots`, { active }),
  loadStart: (scenario: string, durationSec: number) =>
    call<LoadStartResponse>('POST', '/api/load/start', { scenario, durationSec }),
  loadStatus: () => call<LoadStatus>('GET', '/api/load/status'),
  ideal: (id: string) => call<IdealResponse>('GET', `/api/levels/${enc(id)}/ideal`),
  cli: (command: string) => call<CliReply>('POST', '/api/cli', { command }),
  target: () => call<TargetInfo>('GET', '/api/target'),
  // strict: an unreachable target is refused with 502 and the engine stays on the old one.
  setTarget: (redisUrl: string) =>
    call<TargetInfo>('PUT', '/api/target', { redisUrl, strict: true }),
  event: (name: string, data?: unknown) =>
    call<{ ok: boolean }>('POST', '/api/events', { kind: 'custom', name, data }),
  metrics: (seconds = 60) => call<MetricsSeries>('GET', `/api/metrics?seconds=${seconds}`),
  logs: (service: LogService, lines = 500) =>
    call<{ service: string; lines: string[] }>('GET', `/api/logs/${service}?lines=${lines}`),
  portfolio: () => call<PortfolioResponse>('GET', '/api/portfolio'),
  writePortfolio: () => call<PortfolioWriteResponse>('POST', '/api/portfolio/write', {}),
  tree: () => call<{ entries: WorkspaceEntry[] }>('GET', '/api/workspace/tree'),
  readFile: (path: string) =>
    call<{ path: string; content: string; size: number; mtime: string }>(
      'GET',
      `/api/workspace/file?path=${enc(path)}`,
    ),
  writeFile: (path: string, content: string) =>
    call<{ path: string; size: number }>('PUT', `/api/workspace/file?path=${enc(path)}`, {
      content,
    }),
};
