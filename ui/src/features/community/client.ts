import { ApiError } from '../../api';
import type { VerifyResponse } from '../../types';
import type { CommunityLevelData, CommunityList } from './types';

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

const enc = encodeURIComponent;

export const communityApi = {
  list: () => call<CommunityList>('GET', '/api/community'),
  level: (id: string) => call<CommunityLevelData>('GET', `/api/community/levels/${enc(id)}`),
  start: (id: string) =>
    call<{ status: string; startedAt: string }>(
      'POST',
      `/api/community/levels/${enc(id)}/start`,
      {},
    ),
  brainstorm: (id: string, optionId: string, text: string) =>
    call<{ isReasonable: boolean }>('POST', `/api/community/levels/${enc(id)}/brainstorm`, {
      optionId,
      text,
    }),
  hint: (id: string) =>
    call<{ hint: string; revealed: number; hintsTotal: number }>(
      'POST',
      `/api/community/levels/${enc(id)}/hint`,
      {},
    ),
  verify: (id: string, answers: Record<string, string | string[]>) =>
    call<VerifyResponse>('POST', `/api/community/levels/${enc(id)}/verify`, { answers }),
};
