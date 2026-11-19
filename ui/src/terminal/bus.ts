// A tiny bus between lesson text and the terminal: "send to terminal" puts a command on the input line without
// running it. No React, no DOM except the clipboard fallback, so it is importable anywhere (and under vitest).
//
// - One terminal is "live": the most recently mounted one. Hidden duplicates (Next keeps visited routes mounted)
//   are not live.
// - With no terminal mounted, a screen that can open one (the level workbench) registers with `onTerminalWanted`;
//   the text then waits a few seconds for the terminal to mount and take it. Otherwise the text is copied.

export type SendResult = 'terminal' | 'queued' | 'clipboard' | 'failed';

type Insert = (text: string) => void;

const live: Insert[] = [];
const wanted = new Set<() => void>();
let pending: { text: string; at: number } | null = null;
export const PENDING_MS = 4000;

/** A terminal registers its insert function while mounted. Returns the unregister function. */
export function registerTerminal(insert: Insert, now: () => number = Date.now): () => void {
  live.push(insert);
  // A command sent a moment ago while no terminal was open: this one is what was being waited for.
  if (pending && now() - pending.at <= PENDING_MS) {
    const { text } = pending;
    pending = null;
    insert(text);
  }
  return () => {
    const i = live.lastIndexOf(insert);
    if (i >= 0) live.splice(i, 1);
  };
}

export const terminalIsLive = (): boolean => live.length > 0;

/** A screen that can reveal the terminal says so; it is called when text arrives and no terminal is mounted. */
export function onTerminalWanted(fn: () => void): () => void {
  wanted.add(fn);
  return () => wanted.delete(fn);
}

export interface SendDeps {
  copy?: (text: string) => Promise<void>;
  now?: () => number;
}

/** Puts `text` on the live terminal's line (not run), or hands it to a screen that can open one, or copies it. */
export async function sendToTerminal(text: string, deps: SendDeps = {}): Promise<SendResult> {
  const target = live[live.length - 1];
  if (target) {
    target(text);
    return 'terminal';
  }
  if (wanted.size > 0) {
    pending = { text, at: (deps.now ?? Date.now)() };
    for (const fn of [...wanted]) fn();
    return 'queued';
  }
  const copy =
    deps.copy ??
    (typeof navigator !== 'undefined' && navigator.clipboard
      ? (t: string) => navigator.clipboard.writeText(t)
      : null);
  if (!copy) return 'failed';
  try {
    await copy(text);
    return 'clipboard';
  } catch {
    return 'failed';
  }
}

/** Test seam: forget everything. */
export function resetBus(): void {
  live.length = 0;
  wanted.clear();
  pending = null;
}
