// The game's routes as data. Pages live under src/app; these helpers turn a route into its path, read a path back
// (for the header's active link) and read the old hash URLs (`#/level/x`) so bookmarks from the Vite app still land.

export type Route =
  | { name: 'home' }
  | { name: 'level'; id: string }
  | { name: 'terminal' | 'editor' | 'logs' | 'metrics' | 'built' | 'showme' };

const PLAIN = ['terminal', 'editor', 'logs', 'metrics', 'built', 'showme'] as const;
type Plain = (typeof PLAIN)[number];

function isPlain(s: string | undefined): s is Plain {
  return (PLAIN as readonly string[]).includes(s ?? '');
}

function fromParts(parts: string[]): Route {
  const [a, b] = parts;
  if (a === 'level' && b) return { name: 'level', id: safeDecode(b) };
  if (isPlain(a)) return { name: a };
  return { name: 'home' };
}

function safeDecode(s: string): string {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

/** The path of a route: `/`, `/level/<id>`, `/terminal` and so on. */
export function pathFor(r: Route): string {
  if (r.name === 'home') return '/';
  if (r.name === 'level') return `/level/${encodeURIComponent(r.id)}`;
  return `/${r.name}`;
}

/** The route a pathname belongs to; unknown paths count as the map. */
export function parsePath(pathname: string): Route {
  const path = pathname.split(/[?#]/)[0] ?? '';
  return fromParts(path.split('/').filter(Boolean));
}

/** A legacy hash route (`#/level/x`) from the Vite app, or null when the hash is not one. */
export function parseHash(hash: string): Route | null {
  if (!hash.startsWith('#/')) return null;
  const path = hash.slice(2).split('?')[0] ?? '';
  return fromParts(path.split('/').filter(Boolean));
}
