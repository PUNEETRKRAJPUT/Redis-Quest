// Keyboard rules, as pure functions so they can be tested without a DOM.
import { NAV } from './nav';
import type { Route } from '../routes';

/** After `g`, the next key within this long picks a screen. */
export const CHORD_MS = 1200;

export interface KeyLike {
  key: string;
  metaKey?: boolean;
  ctrlKey?: boolean;
  altKey?: boolean;
  repeat?: boolean;
}

export type KeyAction =
  { type: 'none' } | { type: 'arm' } | { type: 'go'; route: Route } | { type: 'help' };

/** True when the key press belongs to something the player is typing into: a field, the terminal, Monaco. */
export function isTypingTarget(target: EventTarget | null): boolean {
  const el = target as {
    tagName?: string;
    isContentEditable?: boolean;
    closest?: (selector: string) => unknown;
  } | null;
  if (!el || typeof el.tagName !== 'string') return false;
  const tag = el.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
  if (el.isContentEditable) return true;
  // xterm and Monaco both type through a hidden textarea, but guard their containers as well.
  return Boolean(
    el.closest?.(
      '.xterm, .monaco-editor, [contenteditable=""], [contenteditable="true"], [role="textbox"]',
    ),
  );
}

/** Cmd+K on a Mac, Ctrl+K elsewhere. Inside the terminal Ctrl+K is the shell's own "kill line", so it stays there. */
export function isPaletteKey(e: KeyLike & { shiftKey?: boolean }, inTerminal: boolean): boolean {
  if (e.key.toLowerCase() !== 'k' || e.altKey || e.shiftKey) return false;
  if (e.metaKey) return true;
  return Boolean(e.ctrlKey) && !inTerminal;
}

/** The `g` then letter chord, and `?`. Hold no state outside this object. */
export function createChord(now: () => number = Date.now) {
  let armedUntil = 0;
  return {
    armed: () => now() < armedUntil,
    reset: () => {
      armedUntil = 0;
    },
    press(e: KeyLike): KeyAction {
      if (e.metaKey || e.ctrlKey || e.altKey || e.repeat) return { type: 'none' };
      const wasArmed = now() < armedUntil;
      armedUntil = 0;
      if (e.key === '?') return { type: 'help' };
      if (wasArmed) {
        const hit = NAV.find((n) => n.key === e.key.toLowerCase());
        return hit ? { type: 'go', route: hit.route } : { type: 'none' };
      }
      if (e.key === 'g') {
        armedUntil = now() + CHORD_MS;
        return { type: 'arm' };
      }
      return { type: 'none' };
    },
  };
}
