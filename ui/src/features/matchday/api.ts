// Match Day's four routes. The shared client (src/api.ts) belongs to the shell, so this feature keeps its own thin
// caller; same origin, same error shape (ApiError) so callers read `code` and `message` the usual way.
import { ApiError } from '@/api';
import type { MatchdayOverview, MatchStatus } from './types';

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

export const matchdayApi = {
  overview: (seed?: number) =>
    call<MatchdayOverview>(
      'GET',
      seed === undefined ? '/api/matchday' : `/api/matchday?seed=${seed}`,
    ),
  status: () => call<MatchStatus>('GET', '/api/matchday/status'),
  start: (seed?: number) =>
    call<MatchStatus>('POST', '/api/matchday/start', seed === undefined ? {} : { seed }),
  stop: () => call<{ stopped: boolean }>('POST', '/api/matchday/stop', {}),
};
