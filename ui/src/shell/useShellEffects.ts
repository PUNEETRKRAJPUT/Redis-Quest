'use client';

// Behaviour hooks of the shell: the keyboard, event toasts, and the height the sticky chrome takes.

import { useEffect, useRef, useState } from 'react';
import type { RefObject } from 'react';
import { toast } from '@/design/toast';
import { play } from '@/design/sound';
import { RANKS, rankFor } from '../game/rank';
import { useQuest } from '../store';
import { createCollapser, describeDanger, describeEvent } from './eventToasts';
import type { ToastSpec } from './eventToasts';
import { createChord, isPaletteKey, isTypingTarget } from './shortcuts';
import type { Route } from '../routes';

/**
 * Cmd/Ctrl+K, `?` and `g` then a letter. Listens in the capture phase so Monaco and xterm cannot swallow Cmd+K.
 * Plain keys never fire while the player types, and stay quiet behind an open dialog. Returns whether `g` is armed
 * (the hint under the page shows which letters are next).
 */
export function useShellKeys(h: {
  onPalette: () => void;
  onHelp: () => void;
  onGo: (route: Route) => void;
}): boolean {
  const [armed, setArmed] = useState(false);
  const handlers = useRef(h);
  useEffect(() => {
    handlers.current = h;
  });
  useEffect(() => {
    const chord = createChord();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const disarmLater = (on: boolean) => {
      if (timer) clearTimeout(timer);
      setArmed(on);
      if (on) timer = setTimeout(() => setArmed(false), 1250);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.isComposing) return;
      const target = e.target as Element | null;
      const inTerminal = Boolean(target?.closest?.('.xterm'));
      if (isPaletteKey(e, inTerminal)) {
        e.preventDefault();
        e.stopPropagation();
        handlers.current.onPalette();
        disarmLater(false);
        return;
      }
      if (e.defaultPrevented || isTypingTarget(e.target)) {
        chord.reset();
        disarmLater(false);
        return;
      }
      // A dialog or the palette is open: the page behind it is inert, and so are its shortcuts.
      if (document.querySelector('dialog[open]')) return;
      const action = chord.press(e);
      if (action.type === 'arm') disarmLater(true);
      else disarmLater(false);
      if (action.type === 'go') {
        e.preventDefault();
        handlers.current.onGo(action.route);
      } else if (action.type === 'help') {
        e.preventDefault();
        handlers.current.onHelp();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => {
      window.removeEventListener('keydown', onKey, true);
      if (timer) clearTimeout(timer);
    };
  }, []);
  return armed;
}

const rankIndex = (id: string) => RANKS.findIndex((r) => r.id === id);

function show(spec: ToastSpec) {
  toast({
    title: spec.title,
    description: spec.description,
    tone: spec.tone,
    cue: spec.cue,
    duration: spec.tone === 'warn' ? 6000 : 3500,
  });
}

/**
 * `level.event` messages become one-line toasts, a dangerous command becomes a warning with `pager`, and a new rank
 * gets a toast of its own. Reads the store directly so nothing re-renders. Repeats inside two seconds collapse.
 */
export function useEventToasts() {
  useEffect(() => {
    const allow = createCollapser(2000);
    const s0 = useQuest.getState();
    let lastSeq = s0.events.at(-1)?.seq ?? 0;
    let lastDanger = s0.dangerous;
    let rankId = s0.progress ? rankFor(s0.progress.xp).rank.id : null;
    return useQuest.subscribe((s) => {
      for (const ev of s.events) {
        if (ev.seq <= lastSeq) continue;
        lastSeq = ev.seq;
        const spec = describeEvent(ev);
        if (spec && allow(spec.key, Date.now())) show(spec);
      }
      if (s.dangerous && s.dangerous !== lastDanger) {
        lastDanger = s.dangerous;
        const spec = describeDanger(s.dangerous.command);
        if (allow(spec.key, Date.now())) show(spec);
      }
      if (s.progress) {
        const r = rankFor(s.progress.xp).rank;
        if (rankId !== null && r.id !== rankId) {
          if (rankIndex(r.id) > rankIndex(rankId))
            toast({
              title: `Rank up: ${r.title}`,
              description: `${s.progress.xp} XP`,
              tone: 'success',
              duration: 5000,
            });
        }
        rankId = r.id;
      }
    });
  }, []);
}

/** Mirrors the sticky chrome's real height into `--hud-h`, so full-height screens can size themselves under it. */
export function useChromeHeight(ref: RefObject<HTMLElement | null>) {
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const root = document.documentElement;
    const set = () =>
      root.style.setProperty('--hud-h', `${Math.round(el.getBoundingClientRect().height)}px`);
    set();
    const ro = new ResizeObserver(set);
    ro.observe(el);
    return () => {
      ro.disconnect();
      root.style.removeProperty('--hud-h');
    };
  }, [ref]);
}

/** A tick on every palette move, as the brief asks. */
export const tick = () => void play('tick');
