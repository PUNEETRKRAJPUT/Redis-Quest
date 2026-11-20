import type { LeagueResponse, ScoreOutcome, ScoreResponse } from './types';

// Same-origin calls to the engine (through the proxy). The score route answers 400, 409 and 503 with a message the
// screen shows, so this returns those as data instead of throwing.

const OFFLINE = 'Cannot reach the game engine. Is the stack running?';

async function readJson(res: Response): Promise<Record<string, unknown>> {
  try {
    const text = await res.text();
    return text ? (JSON.parse(text) as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

export async function fetchLeague(): Promise<LeagueResponse> {
  let res: Response;
  try {
    res = await fetch('/api/league');
  } catch {
    throw new Error(OFFLINE);
  }
  const body = await readJson(res);
  if (!res.ok) {
    throw new Error(
      typeof body.message === 'string' ? body.message : `The engine answered ${res.status}.`,
    );
  }
  return body as unknown as LeagueResponse;
}

export async function scoreAttempt(hole: string, entry: string): Promise<ScoreOutcome> {
  let res: Response;
  try {
    res = await fetch('/api/league/score', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ hole, entry }),
    });
  } catch {
    return { kind: 'offline', message: OFFLINE };
  }
  const body = await readJson(res);
  if (res.ok) return { kind: 'scored', data: body as unknown as ScoreResponse };
  if (res.status === 400 && body.error === 'invalid_entry' && Array.isArray(body.problems)) {
    return {
      kind: 'invalid',
      problems: body.problems as { line: number; col: number; message: string }[],
    };
  }
  return {
    kind: 'refused',
    error: typeof body.error === 'string' ? body.error : 'error',
    message:
      typeof body.message === 'string'
        ? body.message
        : `The engine answered ${res.status}. It may still be starting.`,
  };
}
