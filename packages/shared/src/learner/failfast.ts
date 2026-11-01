// Fail-fast Redis for learner code (A-01). When Redis is down a learner's `redis.hGetAll(...)` must reject
// quickly with a readable error instead of hanging: level 2.10 teaches the catch.
//
// Two layers: the client itself runs with `disableOfflineQueue: true` (an offline client rejects at once
// with ClientOfflineError and nothing replays after a reconnect), and this wrapper races every command
// against a timer for the case the socket looks open but nothing answers. node-redis supports a
// per-command AbortSignal (`client.withAbortSignal(signal)`), so the timer also aborts the command in the
// client's queue; the race is what guarantees the rejection even for a command already written.

/** What a learner sees when a command gets no reply in time. `name` is `RedisCommandTimeoutError`. */
export class RedisCommandTimeoutError extends Error {
  override name = 'RedisCommandTimeoutError';
}

const DEFAULT_TIMEOUT_MS = 2000;

/** `LEARNER_REDIS_COMMAND_TIMEOUT_MS`, default 2000; 0 turns the timeout off. */
export function commandTimeoutFromEnv(env: NodeJS.ProcessEnv = process.env): number {
  const raw = env.LEARNER_REDIS_COMMAND_TIMEOUT_MS;
  if (raw === undefined || raw === '') return DEFAULT_TIMEOUT_MS;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? Math.trunc(n) : DEFAULT_TIMEOUT_MS;
}

// Never timed out: they hold the connection open on purpose, or are not one request/one reply.
const EXEMPT = new Set([
  'on',
  'once',
  'off',
  'emit',
  'addListener',
  'removeListener',
  'removeAllListeners',
  'listeners',
  'rawListeners',
  'listenerCount',
  'eventNames',
  'setMaxListeners',
  'getMaxListeners',
  'prependListener',
  'prependOnceListener',
  'ref',
  'unref',
  'connect',
  'close',
  'quit',
  'destroy',
  'disconnect',
  'subscribe',
  'unsubscribe',
  'pSubscribe',
  'pUnsubscribe',
  'sSubscribe',
  'sUnsubscribe',
  'SUBSCRIBE',
  'UNSUBSCRIBE',
  'PSUBSCRIBE',
  'PUNSUBSCRIBE',
  'SSUBSCRIBE',
  'SUNSUBSCRIBE',
  'withAbortSignal',
  'withCommandOptions',
  'withTypeMapping',
  'withFunctions',
  'withScripts',
  'withOptions',
  'asap',
  'isolated',
  'duplicate',
  'multi',
  'MULTI',
  'scanIterator',
  'hScanIterator',
  'sScanIterator',
  'zScanIterator',
  'monitor',
]);
// Blocking reads are allowed to wait longer than the timeout (their own BLOCK/timeout argument rules).
const BLOCKING = /^(b[lrz][a-z]*|xRead|xReadGroup|XREAD|XREADGROUP|wait|waitAOF|WAIT|WAITAOF)$/i;
const NAMESPACES = new Set(['json', 'ft', 'ts', 'bf', 'cf', 'cms', 'topK', 'tDigest']);

const isThenable = (v: unknown): v is PromiseLike<unknown> =>
  typeof v === 'object' && v !== null && typeof (v as { then?: unknown }).then === 'function';

function race<T>(
  pending: PromiseLike<T>,
  label: string,
  timeoutMs: number,
  abort: AbortController,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      abort.abort();
      reject(
        new RedisCommandTimeoutError(
          `Redis command ${label} got no reply within ${timeoutMs} ms (is Redis down?)`,
        ),
      );
    }, timeoutMs);
    pending.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (e: unknown) => {
        clearTimeout(timer);
        reject(e);
      },
    );
  });
}

/**
 * Wrap a (counting) client so every command rejects after `timeoutMs`. `timeoutMs <= 0` returns the client
 * untouched. Commands go through `client.withAbortSignal(signal)` so the timer also cancels the queued
 * command; derived handles, namespaces, multi() and duplicates stay wrapped.
 */
export function failFast<T extends object>(client: T, timeoutMs: number): T {
  if (!(timeoutMs > 0)) return client;
  const cache = new WeakMap<object, object>();

  const wrap = (target: object, kind: 'client' | 'namespace'): object => {
    const hit = cache.get(target);
    if (hit) return hit;
    const proxy: object = new Proxy({} as object, {
      has: (_s, prop) => prop in target,
      set: (_s, prop, v) => Reflect.set(target, prop, v, target),
      getPrototypeOf: () => Reflect.getPrototypeOf(target),
      get(_s, prop) {
        const value = Reflect.get(target, prop, target) as unknown;
        if (typeof prop !== 'string') return value;
        if (
          kind === 'client' &&
          NAMESPACES.has(prop) &&
          typeof value === 'object' &&
          value !== null
        ) {
          return wrap(value, 'namespace');
        }
        if (typeof value !== 'function') return value;
        const fn = value as (...a: unknown[]) => unknown;
        if (kind === 'client' && (prop === 'multi' || prop === 'MULTI')) {
          return (...a: unknown[]) => wrapMulti(fn.apply(target, a) as object, timeoutMs);
        }
        if (kind === 'client' && prop === 'duplicate') {
          return (...a: unknown[]) => wrap(fn.apply(target, a) as object, 'client');
        }
        if (EXEMPT.has(prop) || BLOCKING.test(prop)) {
          return (...a: unknown[]) => {
            const out = fn.apply(target, a);
            if (out === target) return proxy;
            return kind === 'client' && prop.startsWith('with') && typeof out === 'object' && out
              ? wrap(out, 'client')
              : out;
          };
        }
        return (...a: unknown[]) => {
          const abort = new AbortController();
          let callee: Record<string, unknown> = target as Record<string, unknown>;
          const derive = (target as { withAbortSignal?: (s: AbortSignal) => unknown })
            .withAbortSignal;
          if (kind === 'client' && typeof derive === 'function') {
            // The derived handle comes back through the counting proxy, which counts this call once.
            callee = derive.call(target, abort.signal) as Record<string, unknown>;
          }
          const out = (callee[prop] as (...x: unknown[]) => unknown).apply(callee, a);
          if (out === target || out === callee) return proxy;
          return isThenable(out) ? race(out, prop, timeoutMs, abort) : out;
        };
      },
    });
    cache.set(target, proxy);
    return proxy;
  };

  return wrap(client, 'client') as T;
}

function wrapMulti(multi: object, timeoutMs: number): object {
  const proxy: object = new Proxy({} as object, {
    has: (_s, prop) => prop in multi,
    get(_s, prop) {
      const value = Reflect.get(multi, prop, multi) as unknown;
      if (typeof prop !== 'string' || typeof value !== 'function') return value;
      const fn = value as (...a: unknown[]) => unknown;
      return (...a: unknown[]) => {
        const out = fn.apply(multi, a);
        if (out === multi) return proxy;
        if ((prop === 'exec' || prop === 'EXEC' || prop === 'execAsPipeline') && isThenable(out)) {
          return race(out, prop, timeoutMs, new AbortController());
        }
        return out;
      };
    },
  });
  return proxy;
}
