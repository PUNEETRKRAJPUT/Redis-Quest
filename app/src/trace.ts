import type { LearnerCounters, LearnerDb, LearnerDeps } from '@quest/shared';

/**
 * The request trace behind the phone (D-04). Built only when a request carries `x-quest-trace: 1`; without the
 * header no object is created and no proxy is installed, so an ordinary request pays nothing.
 *
 * It sits on top of the counted deps instead of beside them: a call counts as a Redis command exactly when it
 * moved `counters.redisCommands`, so the trace never keeps a second list of command names. Not traced:
 * `deps.redisCached` (its hits never reach the server, and the counters skip it for the same reason).
 */

export type TraceKind = 'redis' | 'db';
export type TraceBy = 'learner' | 'builtin';

export interface TraceEntry {
  kind: TraceKind;
  /** `GET cache:player:p-028`, `MULTI/EXEC x3`, or the first words of the SQL. Printable ASCII, at most 48 chars. */
  label: string;
  /** Milliseconds from the start of the request scope to the call. */
  startMs: number;
  /** Duration; -1 while the call is still pending. */
  ms: number;
  by: TraceBy;
  ok: boolean;
}

export const TRACE_HEADER = 'x-quest-trace';
/** Entries kept in memory per request; the rest are only counted (a runaway loop must not grow the heap). */
export const MAX_TRACE_ENTRIES = 400;
/** The header value stays under this many characters (Node's default limit is 16 KB for all headers). */
export const MAX_TRACE_HEADER_CHARS = 3500;
const MAX_LABEL = 48;

const round1 = (n: number): number => Math.round(n * 10) / 10;

/** Header values must be printable ASCII; SQL and keys can hold anything. */
export function cleanLabel(raw: string): string {
  const one = raw
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[^\x20-\x7e]/g, '?');
  return one.length > MAX_LABEL ? `${one.slice(0, MAX_LABEL - 1)}~` : one;
}

export class RequestTrace {
  /** Who is running right now: set by the slot runtime around a learner call; everything else is the built-in. */
  by: TraceBy = 'builtin';
  private readonly t0: number;
  private readonly entries: TraceEntry[] = [];
  private dropped = 0;

  constructor(private readonly now: () => number = () => performance.now()) {
    this.t0 = now();
  }

  /** Start an entry; the returned function ends it (call it once). */
  begin(kind: TraceKind, label: string): (ok: boolean) => void {
    if (this.entries.length >= MAX_TRACE_ENTRIES) {
      this.dropped += 1;
      return () => undefined;
    }
    const startMs = this.now() - this.t0;
    const e: TraceEntry = {
      kind,
      label: cleanLabel(label),
      startMs,
      ms: -1,
      by: this.by,
      ok: false,
    };
    this.entries.push(e);
    return (ok) => {
      if (e.ms >= 0) return;
      e.ms = this.now() - this.t0 - startMs;
      e.ok = ok;
    };
  }

  /** Entries in call order; a call that never finished is closed at "now" and marked not ok. */
  snapshot(): TraceEntry[] {
    const now = this.now() - this.t0;
    return this.entries.map((e) =>
      e.ms >= 0 ? { ...e } : { ...e, ms: now - e.startMs, ok: false },
    );
  }

  /**
   * The response header: `{"v":1,"total":12.3,"n":5,"e":[["r","GET k",0.1,0.4,"b",1],...]}`.
   * Row = [kind r|d, label, startMs, ms, by l|b, ok 1|0]. `n` counts every call, `e` is what fit.
   */
  header(): string {
    const total = round1(this.now() - this.t0);
    const rows = this.snapshot().map((e) =>
      JSON.stringify([
        e.kind === 'redis' ? 'r' : 'd',
        e.label,
        round1(e.startMs),
        round1(e.ms),
        e.by === 'learner' ? 'l' : 'b',
        e.ok ? 1 : 0,
      ]),
    );
    const n = rows.length + this.dropped;
    const head = `{"v":1,"total":${total},"n":${n},"e":[`;
    const tail = ']}';
    let size = head.length + tail.length;
    const kept: string[] = [];
    for (const r of rows) {
      const add = r.length + (kept.length > 0 ? 1 : 0);
      if (size + add > MAX_TRACE_HEADER_CHARS) break;
      kept.push(r);
      size += add;
    }
    return head + kept.join(',') + tail;
  }
}

const isThenable = (v: unknown): v is PromiseLike<unknown> =>
  typeof v === 'object' && v !== null && typeof (v as { then?: unknown }).then === 'function';

/** Settle the entry when the command does, handing the caller a promise that behaves like the original. */
function follow(out: unknown, end: (ok: boolean) => void): unknown {
  if (!isThenable(out)) {
    end(true);
    return out;
  }
  return out.then(
    (v) => {
      end(true);
      return v;
    },
    (e: unknown) => {
      end(false);
      throw e;
    },
  );
}

const MODULE_NAMESPACE = /^(json|ft|ts|bf|cf|cms|topK|tDigest|JSON|FT|TS|BF|CF|CMS|TOPK|TDIGEST)$/;
// Methods that hand back another client or handle (the counting proxy keeps those counted; so do we).
const DERIVED = /^(duplicate|with[A-Z]\w*|asap|isolated)$/;

export function commandLabel(ns: string, method: string, args: readonly unknown[]): string {
  let name = method;
  let rest = args;
  if (method === 'sendCommand' && Array.isArray(args[0])) {
    name = String(args[0][0]);
    rest = args[0].slice(1) as unknown[];
  }
  const head = ns ? `${ns}.${name.toUpperCase()}` : name.toUpperCase();
  const first = rest[0];
  return typeof first === 'string' || typeof first === 'number' ? `${head} ${first}` : head;
}

/**
 * Wrap the counted `deps.redis`. Same shape as the counting proxy (empty shadow object, forward to the target) so
 * node-redis' non-configurable properties keep working.
 */
export function traceRedis<T extends object>(
  client: T,
  counters: LearnerCounters,
  trace: RequestTrace,
): T {
  const cache = new WeakMap<object, object>();

  const wrapMulti = (m: object): object => {
    let queued = 0;
    const proxy: object = new Proxy({} as object, {
      has: (_s, prop) => prop in m,
      get(_s, prop) {
        const value = Reflect.get(m, prop, m) as unknown;
        if (typeof prop !== 'string' || typeof value !== 'function') return value;
        const fn = value as (...a: unknown[]) => unknown;
        return (...a: unknown[]) => {
          const before = counters.redisCommands;
          const out = fn.apply(m, a);
          if (counters.redisCommands === before) {
            // Queued, not sent: the whole transaction or pipeline becomes one bar when it is executed.
            if (out === m) {
              queued += 1;
              return proxy;
            }
            return out;
          }
          const label = `${prop.toLowerCase() === 'execaspipeline' ? 'PIPELINE' : 'MULTI/EXEC'} x${queued}`;
          queued = 0;
          return follow(out, trace.begin('redis', label));
        };
      },
    });
    return proxy;
  };

  const wrap = (t: object, ns: string): object => {
    const hit = cache.get(t);
    if (hit) return hit;
    const proxy: object = new Proxy({} as object, {
      has: (_s, prop) => prop in t,
      set: (_s, prop, v) => Reflect.set(t, prop, v, t),
      getPrototypeOf: () => Reflect.getPrototypeOf(t),
      get(_s, prop) {
        const value = Reflect.get(t, prop, t) as unknown;
        if (typeof prop !== 'string') return value;
        if (ns === '' && MODULE_NAMESPACE.test(prop) && typeof value === 'object' && value !== null)
          return wrap(value, prop.toUpperCase());
        if (typeof value !== 'function') return value;
        const fn = value as (...a: unknown[]) => unknown;
        if (ns === '' && (prop === 'multi' || prop === 'MULTI'))
          return (...a: unknown[]) => wrapMulti(fn.apply(t, a) as object);
        return (...a: unknown[]) => {
          const before = counters.redisCommands;
          const out = fn.apply(t, a);
          if (out === t) return proxy;
          if (counters.redisCommands === before) {
            // Not a command. A derived client stays traced; anything else (listeners, lifecycle) is untouched.
            return ns === '' &&
              DERIVED.test(prop) &&
              typeof out === 'object' &&
              out !== null &&
              !isThenable(out)
              ? wrap(out, '')
              : out;
          }
          return follow(out, trace.begin('redis', commandLabel(ns, prop, a)));
        };
      },
    });
    cache.set(t, proxy);
    return proxy;
  };

  return wrap(client, '') as T;
}

/** One line of SQL as a label: `SELECT * FROM players WHERE id = $1` stays readable at 48 characters. */
export function traceDb(db: LearnerDb, trace: RequestTrace): LearnerDb {
  return {
    async query(text, params) {
      const end = trace.begin('db', text);
      try {
        const res = await db.query(text, params);
        end(true);
        return res;
      } catch (err) {
        end(false);
        throw err;
      }
    },
  };
}

export function traceDeps(
  deps: LearnerDeps,
  counters: LearnerCounters,
  trace: RequestTrace,
): LearnerDeps {
  return {
    ...deps,
    redis: traceRedis(deps.redis, counters, trace),
    db: traceDb(deps.db, trace),
  };
}
