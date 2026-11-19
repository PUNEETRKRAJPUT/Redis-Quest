// Pure logic for the chapter chat thread: grouping, pacing, the "seen" hash and storage, avatar colours.
// No React, no DOM: everything here runs under vitest in plain Node.
import type { ThreadMessage } from '../types';

/* ------------------------------------------------------------------ grouping */

export type MessageGroup = {
  from: string;
  /** Index (into the original array) of the first message of the group. */
  start: number;
  messages: ThreadMessage[];
};

/** Consecutive messages from the same sender share one group: one avatar, one name. */
export function groupMessages(messages: readonly ThreadMessage[]): MessageGroup[] {
  const groups: MessageGroup[] = [];
  messages.forEach((m, i) => {
    const last = groups[groups.length - 1];
    if (last && last.from === m.from) last.messages.push(m);
    else groups.push({ from: m.from, start: i, messages: [m] });
  });
  return groups;
}

/** Is message `i` the first of its run from one sender? */
export const startsGroup = (messages: readonly ThreadMessage[], i: number): boolean =>
  i === 0 || messages[i - 1]?.from !== messages[i]?.from;

/** Senders in order of first appearance (the "members" of the group chat). */
export function participants(messages: readonly ThreadMessage[]): string[] {
  const seen: string[] = [];
  for (const m of messages) if (!seen.includes(m.from)) seen.push(m.from);
  return seen;
}

/* ------------------------------------------------------------------ pacing */

export const TYPING_BASE_MS = 150;
export const TYPING_PER_CHAR_MS = 6;
export const TYPING_CAP_MS = 750;
/** Quiet beat between a message landing and the next sender starting to type. */
export const GAP_MS = 140;
/** A follow-up from the same sender comes faster, like a burst of short texts. */
export const SAME_SENDER_FACTOR = 0.55;
/** Under this a typing indicator would only flicker, so it is skipped. */
export const MIN_TYPING_MS = 110;
export const MAX_REVEAL_MS = 8000;

/** How long the typing dots show for a message of this length: grows with the text, never above the cap. */
export function typingDelay(text: string, capMs: number = TYPING_CAP_MS): number {
  const len = Array.from(text.trim()).length;
  return Math.round(Math.min(capMs, TYPING_BASE_MS + len * TYPING_PER_CHAR_MS));
}

export type RevealStep = { gapMs: number; typingMs: number };
export type RevealPlan = { steps: RevealStep[]; totalMs: number; scale: number };

/**
 * The whole arrival as data. Each message has a quiet gap then a typing phase. If the natural total would exceed
 * `capMs` every step is scaled down proportionally, so a long thread never makes the player wait.
 */
export function planReveal(
  messages: readonly ThreadMessage[],
  capMs: number = MAX_REVEAL_MS,
): RevealPlan {
  const raw = messages.map((m, i) => {
    const burst = i > 0 && messages[i - 1]?.from === m.from;
    return {
      gapMs: i === 0 ? 200 : burst ? Math.round(GAP_MS * 0.6) : GAP_MS,
      typingMs: Math.round(typingDelay(m.text) * (burst ? SAME_SENDER_FACTOR : 1)),
    };
  });
  const natural = raw.reduce((t, s) => t + s.gapMs + s.typingMs, 0);
  const scale = natural > capMs && natural > 0 ? capMs / natural : 1;
  const steps = raw.map((s) => ({
    gapMs: Math.round(s.gapMs * scale),
    typingMs: Math.round(s.typingMs * scale),
  }));
  return { steps, totalMs: steps.reduce((t, s) => t + s.gapMs + s.typingMs, 0), scale };
}

/** Sound throttle: at most one `msg` cue per `minGapMs`, so a fast, long thread does not machine-gun. */
export function shouldPlayCue(nowMs: number, lastMs: number | null, minGapMs = 140): boolean {
  return lastMs === null || nowMs - lastMs >= minGapMs;
}

/* ------------------------------------------------------------------ seen */

/** FNV-1a (32 bit) over sender, time and text of every message: stable, tiny, no dependency. */
export function contentHash(messages: readonly ThreadMessage[]): string {
  let h = 0x811c9dc5;
  const feed = (s: string) => {
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 0x01000193) >>> 0;
    }
  };
  for (const m of messages) {
    feed(m.from);
    feed('\u0001');
    feed(m.time);
    feed('\u0001');
    feed(m.text);
    feed('\u0002');
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

export const SEEN_PREFIX = 'rq:thread-seen:';
export const seenKey = (hash: string): string => SEEN_PREFIX + hash;

type StorageLike = Pick<Storage, 'getItem' | 'setItem'>;

/** localStorage when it works (it can throw in private modes), otherwise undefined. */
export function browserStorage(): StorageLike | undefined {
  try {
    return typeof window !== 'undefined' ? window.localStorage : undefined;
  } catch {
    return undefined;
  }
}

export function readSeen(
  hash: string,
  storage: StorageLike | undefined = browserStorage(),
): boolean {
  try {
    return storage?.getItem(seenKey(hash)) === '1';
  } catch {
    return false;
  }
}

export function writeSeen(hash: string, storage: StorageLike | undefined = browserStorage()): void {
  try {
    storage?.setItem(seenKey(hash), '1');
  } catch {
    /* storage full or blocked: the thread simply animates again next time */
  }
}

export type AnimateMode = 'auto' | 'always' | 'never';

/**
 * Should this thread play its arrival now? `auto` plays on first view only, `always` ignores what was seen,
 * `never` shows everything. Reduced motion always shows everything at once.
 */
export function shouldPlay(opts: {
  mode: AnimateMode;
  seen: boolean;
  reduced: boolean;
  count: number;
}): boolean {
  if (opts.count === 0 || opts.reduced || opts.mode === 'never') return false;
  return opts.mode === 'always' || !opts.seen;
}

/* ------------------------------------------------------------------ avatars */

export type AvatarTone = {
  /** Static Tailwind class strings (the compiler cannot see built-up names). */
  avatar: string;
  name: string;
};

// Every tone is a brief token; text on its 15% wash stays above 4.5:1 on night-800.
const TONES: AvatarTone[] = [
  { avatar: 'bg-sky/15 text-sky ring-sky/40', name: 'text-sky' },
  { avatar: 'bg-flood-500/15 text-flood-400 ring-flood-500/40', name: 'text-flood-400' },
  { avatar: 'bg-cap-purple/15 text-cap-purple ring-cap-purple/40', name: 'text-cap-purple' },
  { avatar: 'bg-turf/15 text-turf ring-turf/40', name: 'text-turf' },
  { avatar: 'bg-wicket/15 text-wicket ring-wicket/40', name: 'text-wicket' },
];

// The five regulars get fixed, distinct tones so the cast never collides; anyone else hashes into the set.
const CAST_TONE: Record<string, number> = {
  roommate: 0,
  senior: 1,
  warden: 2,
  'sms-vendor': 3,
  'rival-college': 4,
};

export function hashString(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

export function toneIndex(slug: string): number {
  return CAST_TONE[slug] ?? hashString(slug) % TONES.length;
}

/** The avatar colour for a sender, derived from the slug: same sender, same colour, everywhere. */
export function avatarTone(slug: string): AvatarTone {
  return TONES[toneIndex(slug)] as AvatarTone;
}

/** Up to two initials from a display name: "Harry Bhaiya" gives HB, "Teja" gives T. */
export function initials(displayName: string): string {
  const words = displayName.trim().split(/\s+/).filter(Boolean);
  const letters = words.slice(0, 2).map((w) => Array.from(w)[0] ?? '');
  return letters.join('').toUpperCase() || '?';
}
