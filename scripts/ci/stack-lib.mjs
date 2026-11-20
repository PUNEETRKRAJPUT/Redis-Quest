// Pure helpers for scripts/ci/stack.mjs, kept apart so they can be unit tested (stack-lib.test.mjs) without
// starting anything. No dependencies.

/**
 * Which backend answers a request path, the way docker/Caddyfile routes it:
 * `/app/*` goes to the app with its prefix kept; `/api`, `/api/*`, `/health`, `/health/*`, `/ws`, `/ws/*` and
 * `/internal/*` go to the engine; everything else is a page for the ui service, which this stack does not run.
 * @param {string} url request URL (path and optional query)
 * @returns {'app' | 'engine' | null}
 */
export function routeFor(url) {
  const path = String(url).split('?')[0];
  if (path.startsWith('/app/')) return 'app';
  if (/^\/(api|health|ws)(\/|$)/.test(path) || path.startsWith('/internal/')) return 'engine';
  return null;
}

/** A URL with its password replaced, safe to print. */
export function redactUrl(value) {
  try {
    const u = new URL(value);
    if (u.password) u.password = '***';
    return u.toString();
  } catch {
    return '(not a valid URL)';
  }
}

/** The port of a URL, or `fallback` when the URL names none (redis://host has none, so 6379). */
export function portOf(value, fallback) {
  try {
    const p = new URL(value).port;
    return p === '' ? String(fallback) : p;
  } catch {
    return String(fallback);
  }
}

/** One command as a RESP array of bulk strings, the form every Redis server accepts. */
export function encodeCommand(args) {
  let out = `*${args.length}\r\n`;
  for (const a of args) {
    const s = String(a);
    out += `$${Buffer.byteLength(s)}\r\n${s}\r\n`;
  }
  return out;
}

/**
 * The settings docker-compose.yml starts the game's Redis with (`--maxmemory 512mb --save 60 1000 --appendonly yes
 * --appendfsync everysec`), plus the default policy. A CI service container starts a bare `redis:8`, and a few
 * levels read or reset these, so the stack puts them in place before the engine starts.
 */
export const REDIS_DEFAULTS = [
  ['CONFIG', 'SET', 'maxmemory', '536870912'],
  ['CONFIG', 'SET', 'maxmemory-policy', 'noeviction'],
  ['CONFIG', 'SET', 'save', '60 1000'],
  ['CONFIG', 'SET', 'appendonly', 'yes'],
  ['CONFIG', 'SET', 'appendfsync', 'everysec'],
];

/** True when a /health body says Redis and Postgres are both up and the levels loaded (what G-01 waits for). */
export function healthIsReady(body) {
  try {
    const j = typeof body === 'string' ? JSON.parse(body) : body;
    return j?.redis === 'up' && j?.postgres === 'up' && j?.levels === 'ok';
  } catch {
    return false;
  }
}
