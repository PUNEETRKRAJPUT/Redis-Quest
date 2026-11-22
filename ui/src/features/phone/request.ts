import { TRACE_HEADER, parseTraceHeader, type ParsedTrace } from './trace';

/** Which version of the route answered: from `x-quest-slots` (`slot=learner|baseline|baseline-load-error`). */
export type Served = 'learner' | 'builtin' | 'fallback';

export interface PhoneResult {
  path: string;
  /** 0 when the request never got an answer (the stack is down or the proxy dropped it). */
  status: number;
  ok: boolean;
  /** Click to last byte, as the player's browser saw it. */
  ms: number;
  body: unknown;
  /** The app's error code (`player_not_found`, `slot_error`, ...) and message, when the answer was an error. */
  errorCode?: string;
  message?: string;
  served: Served;
  /** The slot names the route ran, e.g. `cache.getPlayerStats`. Empty for a route with no slot. */
  slots: string[];
  instance?: string;
  trace: ParsedTrace | null;
}

/** `cache.getPlayerStats=learner, other=baseline` -> pairs; unreadable pieces are skipped. */
export function parseSlotsHeader(
  value: string | null | undefined,
): { slot: string; path: string }[] {
  if (!value) return [];
  const out: { slot: string; path: string }[] = [];
  for (const part of value.split(',')) {
    const [slot, path] = part.trim().split('=');
    if (slot && path) out.push({ slot, path });
  }
  return out;
}

export function servedFrom(pairs: readonly { slot: string; path: string }[]): Served {
  if (pairs.some((p) => p.path === 'learner')) return 'learner';
  if (pairs.some((p) => p.path === 'baseline-load-error')) return 'fallback';
  return 'builtin';
}

export interface RequestDeps {
  fetch: typeof fetch;
  now: () => number;
  timeoutMs: number;
}

const defaults = (): RequestDeps => ({
  fetch: (...a) => fetch(...a),
  now: () => performance.now(),
  timeoutMs: 15_000,
});

/** One GET through the proxy with the trace header on. Never throws: a dead stack is a result with status 0. */
export async function callRoute(
  path: string,
  deps: RequestDeps = defaults(),
): Promise<PhoneResult> {
  const t0 = deps.now();
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), deps.timeoutMs);
  const failed = (message: string): PhoneResult => ({
    path,
    status: 0,
    ok: false,
    ms: deps.now() - t0,
    body: null,
    errorCode: 'unreachable',
    message,
    served: 'builtin',
    slots: [],
    trace: null,
  });
  try {
    let res: Response;
    try {
      res = await deps.fetch(path, {
        headers: { [TRACE_HEADER]: '1' },
        cache: 'no-store',
        signal: abort.signal,
      });
    } catch {
      return failed(
        abort.signal.aborted
          ? `No answer after ${Math.round(deps.timeoutMs / 1000)} s`
          : 'Cannot reach the app. Is the stack running?',
      );
    }
    const text = await res.text();
    const ms = deps.now() - t0;
    let body: unknown = null;
    try {
      body = text ? (JSON.parse(text) as unknown) : null;
    } catch {
      body = null;
    }
    const pairs = parseSlotsHeader(res.headers.get('x-quest-slots'));
    const obj = typeof body === 'object' && body !== null ? (body as Record<string, unknown>) : {};
    const instance = res.headers.get('x-quest-instance');
    return {
      path,
      status: res.status,
      ok: res.ok,
      ms,
      body,
      ...(res.ok
        ? {}
        : {
            errorCode: typeof obj.error === 'string' ? obj.error : 'error',
            message: typeof obj.message === 'string' ? obj.message : `HTTP ${res.status}`,
          }),
      served: servedFrom(pairs),
      slots: pairs.map((p) => p.slot),
      ...(instance ? { instance } : {}),
      trace: parseTraceHeader(res.headers.get(TRACE_HEADER)),
    };
  } finally {
    clearTimeout(timer);
  }
}

/** Run `times` requests one after another (so they do not queue behind each other) and keep each result. */
export async function runMany(
  path: string,
  times: number,
  call: (path: string) => Promise<PhoneResult>,
  onEach?: (r: PhoneResult, i: number) => void,
): Promise<PhoneResult[]> {
  const out: PhoneResult[] = [];
  for (let i = 0; i < times; i += 1) {
    const r = await call(path);
    out.push(r);
    onEach?.(r, i);
  }
  return out;
}
