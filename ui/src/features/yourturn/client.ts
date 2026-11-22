// The few engine calls of D-06's screens. `ui/src/api.ts` is not mine to extend, so these are plain same-origin
// fetches that never throw: a failure is a value the screen can word.
import { readCoverage, type AnyEvent, type Coverage } from './logic';

export async function getJson(path: string): Promise<{ ok: boolean; body: unknown }> {
  try {
    const res = await fetch(path);
    const text = await res.text();
    let body: unknown = null;
    try {
      body = text ? JSON.parse(text) : null;
    } catch {
      // The proxy answers a non-JSON 502 while the engine boots.
    }
    return { ok: res.ok, body };
  } catch {
    return { ok: false, body: null };
  }
}

export async function fetchCoverage(): Promise<Coverage> {
  const r = await getJson('/api/coverage');
  if (!r.ok)
    return { available: false, reason: 'Cannot reach the game engine. Is the stack running?' };
  return readCoverage(r.body);
}

/** The engine's recent level events (its ring holds the last 200); empty when unreachable. */
export async function fetchEvents(): Promise<AnyEvent[]> {
  const r = await getJson('/api/events');
  const events = (r.body as { events?: unknown } | null)?.events;
  return r.ok && Array.isArray(events) ? (events as AnyEvent[]) : [];
}

export interface CommunityAuthor {
  name: string;
  github?: string;
}
export interface CommunityLevelLine {
  id: string;
  title: string;
  author: CommunityAuthor | null;
}

/** GET /api/community, reduced to what the credits need; null when it cannot be read. */
export async function fetchCommunityLevels(): Promise<CommunityLevelLine[] | null> {
  const r = await getJson('/api/community');
  const packs = (r.body as { packs?: unknown } | null)?.packs;
  if (!r.ok || !Array.isArray(packs)) return null;
  const out: CommunityLevelLine[] = [];
  for (const p of packs as { levels?: unknown }[]) {
    if (!Array.isArray(p.levels)) continue;
    for (const l of p.levels as Record<string, unknown>[]) {
      if (typeof l.id !== 'string' || typeof l.title !== 'string') continue;
      const a = l.author as { name?: unknown; github?: unknown } | null;
      out.push({
        id: l.id,
        title: l.title,
        author:
          a && typeof a.name === 'string'
            ? { name: a.name, ...(typeof a.github === 'string' ? { github: a.github } : {}) }
            : null,
      });
    }
  }
  return out;
}
