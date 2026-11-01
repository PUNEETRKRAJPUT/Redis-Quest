import type { LearnerCounters } from './types.js';

// Redis client methods that do not send a command. They are never counted.
const NOT_COMMANDS = new Set([
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
]);
// Return a derived client/handle; not a command themselves, but the result must stay counted.
const DERIVE = new Set([
  'withAbortSignal',
  'withCommandOptions',
  'withTypeMapping',
  'withFunctions',
  'withScripts',
  'withOptions',
  'asap',
  'isolated',
]);
// Lifecycle calls from learner code are swallowed so one module cannot close a shared client.
const LIFECYCLE = new Set(['connect', 'close', 'quit', 'destroy', 'disconnect']);
// Module namespaces on the client (client.json.set, client.ft.search, ...): their methods are commands.
const NAMESPACES = new Set([
  'json',
  'ft',
  'ts',
  'bf',
  'cf',
  'cms',
  'topK',
  'tDigest',
  'JSON',
  'FT',
  'TS',
  'BF',
  'CF',
  'CMS',
  'TOPK',
  'TDIGEST',
]);
const MULTI_EXEC = new Set(['exec', 'EXEC', 'execAsPipeline']);
const MULTI_RESET = new Set(['discard', 'DISCARD']);

export interface CountingOptions {
  /** Called with every client created by `duplicate()` so the owner can close it. */
  onDuplicate?: (client: { close?: () => unknown; destroy?: () => unknown }) => void;
  /**
   * Builds the clone for `duplicate()` when the client has no such method (a node-redis Sentinel client does not).
   * The clone is counted and handed to `onDuplicate` like a real one.
   */
  fallbackDuplicate?: () => object;
}

/**
 * Wrap a node-redis v5 client so every command is counted in `counters.redisCommands`.
 * Rules (also in the handoff): a call to any command method (camelCase or UPPERCASE alias, nested module
 * namespaces such as json/ft/ts, and `sendCommand`) counts 1 when invoked, whether or not it later fails;
 * commands issued in the same tick (auto-pipelining) still count one each; `multi()` and chaining count
 * nothing, `exec()` / `execAsPipeline()` counts 1 if at least one command was queued; listener methods and
 * lifecycle methods count 0; `duplicate()` returns a counted clone.
 */
export function countRedis<T extends object>(
  client: T,
  counters: LearnerCounters,
  opts: CountingOptions = {},
): T {
  const cache = new WeakMap<object, object>();

  // Proxies wrap an empty shadow object and forward to `t`: node-redis exposes some namespaces as
  // non-configurable own properties, and a proxy may not report a different value for those.
  // `swallow` is true for the injected client only; a duplicate() clone keeps its own lifecycle.
  const wrap = (t: object, kind: 'client' | 'namespace', swallow = kind === 'client'): object => {
    const hit = cache.get(t);
    if (hit) return hit;
    const proxy: object = new Proxy({} as object, {
      has: (_s, prop) => prop in t,
      set: (_s, prop, v) => Reflect.set(t, prop, v, t),
      getPrototypeOf: () => Reflect.getPrototypeOf(t),
      get(_s, prop) {
        const value = Reflect.get(t, prop, t) as unknown;
        if (typeof prop !== 'string') return value;
        if (
          kind !== 'namespace' &&
          NAMESPACES.has(prop) &&
          typeof value === 'object' &&
          value !== null
        ) {
          return wrap(value, 'namespace');
        }
        if (
          kind === 'client' &&
          prop === 'duplicate' &&
          typeof value !== 'function' &&
          opts.fallbackDuplicate
        ) {
          const make = opts.fallbackDuplicate;
          return () => {
            const clone = make();
            opts.onDuplicate?.(clone as never);
            return wrap(clone, 'client', false);
          };
        }
        if (typeof value !== 'function') return value;
        const fn = value as (...a: unknown[]) => unknown;
        if (LIFECYCLE.has(prop)) {
          if (swallow)
            return () => (prop === 'connect' ? Promise.resolve(proxy) : Promise.resolve());
          return (...a: unknown[]) => keepWrapped(fn.apply(t, a), t, proxy); // a duplicate's own lifecycle, not counted
        }
        if (NOT_COMMANDS.has(prop))
          return (...a: unknown[]) => keepWrapped(fn.apply(t, a), t, proxy);
        if (kind !== 'namespace' && prop === 'duplicate') {
          return (...a: unknown[]) => {
            const clone = fn.apply(t, a) as object;
            opts.onDuplicate?.(clone as never);
            return wrap(clone, 'client', false);
          };
        }
        if (kind !== 'namespace' && (prop === 'multi' || prop === 'MULTI')) {
          return (...a: unknown[]) => wrapMulti(fn.apply(t, a) as object, counters, proxy);
        }
        if (kind !== 'namespace' && DERIVE.has(prop)) {
          return (...a: unknown[]) => {
            const out = fn.apply(t, a);
            return typeof out === 'object' && out !== null ? wrap(out, 'client', swallow) : out;
          };
        }
        return (...a: unknown[]) => {
          counters.redisCommands += 1;
          return keepWrapped(fn.apply(t, a), t, proxy);
        };
      },
    });
    cache.set(t, proxy);
    return proxy;
  };

  return wrap(client, 'client') as T;
}

function keepWrapped(result: unknown, target: object, proxy: object): unknown {
  return result === target ? proxy : result;
}

function wrapMulti(multi: object, counters: LearnerCounters, parent: object): object {
  let queued = 0;
  const t = multi;
  const proxy: object = new Proxy({} as object, {
    has: (_s, prop) => prop in t,
    get(_s, prop) {
      const value = Reflect.get(t, prop, t) as unknown;
      if (typeof prop !== 'string' || typeof value !== 'function') return value;
      const fn = value as (...a: unknown[]) => unknown;
      if (MULTI_EXEC.has(prop)) {
        return (...a: unknown[]) => {
          if (queued > 0) counters.redisCommands += 1;
          queued = 0;
          return fn.apply(t, a);
        };
      }
      if (MULTI_RESET.has(prop)) {
        return (...a: unknown[]) => {
          queued = 0;
          return keepWrapped(fn.apply(t, a), t, proxy);
        };
      }
      return (...a: unknown[]) => {
        queued += 1;
        return keepWrapped(fn.apply(t, a), t, proxy);
      };
    },
  });
  void parent;
  return proxy;
}
