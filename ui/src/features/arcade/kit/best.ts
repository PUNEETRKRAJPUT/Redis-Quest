// Best scores, one number per cabinet, in localStorage. Storage can be missing or blocked (private window, cleared
// site data): every access is wrapped, and the game works the same without it.

export const BEST_PREFIX = 'rq:arcade:best:';

export type StorageLike = Pick<Storage, 'getItem' | 'setItem'>;

function browserStorage(): StorageLike | null {
  try {
    return typeof window !== 'undefined' ? window.localStorage : null;
  } catch {
    return null;
  }
}

export const bestKey = (cabinetId: string): string => `${BEST_PREFIX}${cabinetId}`;

/** The saved best score, or null when there is none (or it is not a plain non-negative whole number). */
export function readBest(
  cabinetId: string,
  storage: StorageLike | null = browserStorage(),
): number | null {
  if (!storage) return null;
  try {
    const raw = storage.getItem(bestKey(cabinetId));
    if (raw === null || !/^\d{1,9}$/.test(raw)) return null;
    return Number(raw);
  } catch {
    return null;
  }
}

export interface Recorded {
  best: number;
  /** True when this score beat the saved one (a first score above zero counts). */
  isNew: boolean;
}

/** Saves the score if it beats the best. Returns the best after the call. */
export function recordScore(
  cabinetId: string,
  score: number,
  storage: StorageLike | null = browserStorage(),
): Recorded {
  const clean = Number.isFinite(score) && score > 0 ? Math.floor(score) : 0;
  const before = readBest(cabinetId, storage);
  const isNew = before === null ? clean > 0 : clean > before;
  if (!isNew) return { best: before ?? clean, isNew: false };
  try {
    storage?.setItem(bestKey(cabinetId), String(clean));
  } catch {
    // Not saved; the player still sees the score they just made.
  }
  return { best: clean, isNew: true };
}
