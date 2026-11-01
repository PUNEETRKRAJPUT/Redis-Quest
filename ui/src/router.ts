import { useEffect, useState } from 'react';

export type Route =
  | { name: 'home' }
  | { name: 'level'; id: string }
  | { name: 'terminal' | 'editor' | 'logs' | 'metrics' | 'built' | 'showme' };

export function parseHash(hash: string): Route {
  const path = hash.replace(/^#\/?/, '').split('?')[0] ?? '';
  const parts = path.split('/').filter(Boolean);
  const [a, b] = parts;
  if (a === 'level' && b) return { name: 'level', id: decodeURIComponent(b) };
  if (a === 'terminal' || a === 'editor' || a === 'logs' || a === 'metrics' || a === 'built' || a === 'showme') return { name: a };
  return { name: 'home' };
}

export function hrefFor(r: Route): string {
  if (r.name === 'home') return '#/';
  if (r.name === 'level') return `#/level/${encodeURIComponent(r.id)}`;
  return `#/${r.name}`;
}

export function useRoute(): Route {
  const [route, setRoute] = useState<Route>(() => parseHash(location.hash));
  useEffect(() => {
    const on = () => {
      setRoute(parseHash(location.hash));
      window.scrollTo(0, 0);
    };
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);
  return route;
}
