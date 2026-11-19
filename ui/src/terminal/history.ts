// The commands the player has run in this browser session: Up and Down walk them. Persisted in sessionStorage, so
// a reload keeps them and a new tab starts clean. Pure functions plus two guarded storage calls.

export const HISTORY_MAX = 200;
export const HISTORY_KEY = 'rq:terminal:history';

/** A new list with `text` at the end: blank lines are not kept, and the same command twice in a row is one entry. */
export function pushHistory(list: readonly string[], text: string, max = HISTORY_MAX): string[] {
  const t = text.trim();
  if (!t || list[list.length - 1] === t) return [...list];
  const next = [...list, t];
  return next.length > max ? next.slice(next.length - max) : next;
}

export interface HistoryWalk {
  /** Position in the list; `list.length` means "the line being typed". */
  index: number;
  /** What was on the line when the walk started, so walking back down returns to it. */
  draft: string;
}

export const startWalk = (list: readonly string[]): HistoryWalk => ({
  index: list.length,
  draft: '',
});

/** Up: the previous command. Returns null at the oldest entry (the line stays as it is). */
export function older(
  list: readonly string[],
  w: HistoryWalk,
  current: string,
): { walk: HistoryWalk; text: string } | null {
  if (w.index <= 0) return null;
  const draft = w.index === list.length ? current : w.draft;
  const index = w.index - 1;
  return { walk: { index, draft }, text: list[index] ?? '' };
}

/** Down: the next command, or the draft after the last one. Returns null when already on the draft. */
export function newer(
  list: readonly string[],
  w: HistoryWalk,
): { walk: HistoryWalk; text: string } | null {
  if (w.index >= list.length) return null;
  const index = w.index + 1;
  return { walk: { ...w, index }, text: index === list.length ? w.draft : (list[index] ?? '') };
}

type Store = Pick<Storage, 'getItem' | 'setItem'>;

function defaultStore(): Store | null {
  try {
    return typeof sessionStorage === 'undefined' ? null : sessionStorage;
  } catch {
    return null; // blocked storage (private window, site data off)
  }
}

export function loadHistory(store: Store | null = defaultStore()): string[] {
  try {
    const raw = store?.getItem(HISTORY_KEY);
    if (!raw) return [];
    const v: unknown = JSON.parse(raw);
    if (!Array.isArray(v)) return [];
    return v
      .filter((x): x is string => typeof x === 'string' && x.trim() !== '')
      .slice(-HISTORY_MAX);
  } catch {
    return [];
  }
}

export function saveHistory(list: readonly string[], store: Store | null = defaultStore()): void {
  try {
    store?.setItem(HISTORY_KEY, JSON.stringify(list.slice(-HISTORY_MAX)));
  } catch {
    /* quota or blocked: the session still has the in-memory list */
  }
}
