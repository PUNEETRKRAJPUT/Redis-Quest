import { getJson } from '../yourturn/client';
import type { CastMember, Contributor, CreditsData } from './logic';

/** GET /api/credits; null when the engine cannot be reached or answers something else. */
export async function fetchCredits(): Promise<CreditsData | null> {
  const r = await getJson('/api/credits');
  const b = r.body as { cast?: unknown; contributors?: unknown } | null;
  if (!r.ok || !b) return null;
  return {
    cast: Array.isArray(b.cast) ? (b.cast as CastMember[]) : null,
    contributors: Array.isArray(b.contributors) ? (b.contributors as Contributor[]) : null,
  };
}
