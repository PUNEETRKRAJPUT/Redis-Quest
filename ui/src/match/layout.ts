'use client';
// Layout plumbing for the match view: a media query, a height that fills the window below the HUD, and a storage
// wrapper for remembered pane sizes that never throws (private windows, disabled storage).
import { useCallback, useLayoutEffect, useState, useSyncExternalStore } from 'react';
import type { LayoutStorage } from 'react-resizable-panels';

/** Three panes from this width up; below it the panes stack (spec: at 1280 nothing is cramped). */
export const PANES_MIN_WIDTH = 1280;

export function useMediaQuery(query: string): boolean {
  const subscribe = useCallback(
    (fn: () => void) => {
      const m = window.matchMedia(query);
      m.addEventListener('change', fn);
      return () => m.removeEventListener('change', fn);
    },
    [query],
  );
  return useSyncExternalStore(
    subscribe,
    () => window.matchMedia(query).matches,
    () => false,
  );
}

/**
 * The pixel height from this element's top to the bottom of the window, kept current when the window, or anything
 * above the element (the HUD, a rain-delay strip, the mirror banner), changes size. Null until measured.
 */
export function useFillHeight(enabled: boolean): [(el: HTMLElement | null) => void, number | null] {
  const [el, setEl] = useState<HTMLElement | null>(null);
  const [h, setH] = useState<number | null>(null);
  useLayoutEffect(() => {
    if (!enabled || !el) return;
    const measure = () => {
      // A hidden route (Next keeps visited routes mounted with display: none) has no box: keep the last value.
      if (!el.offsetParent && el.getClientRects().length === 0) return;
      const top = el.getBoundingClientRect().top + window.scrollY;
      setH(Math.max(420, Math.floor(window.innerHeight - top)));
    };
    measure();
    window.addEventListener('resize', measure);
    const ro = new ResizeObserver(measure);
    // The element's previous siblings and its ancestors' previous siblings are what can push it down.
    for (let n: HTMLElement | null = el; n && n !== document.body; n = n.parentElement) {
      let s = n.previousElementSibling;
      while (s) {
        ro.observe(s);
        s = s.previousElementSibling;
      }
    }
    return () => {
      window.removeEventListener('resize', measure);
      ro.disconnect();
    };
  }, [el, enabled]);
  return [setEl, enabled ? h : null];
}

/** localStorage for remembered pane sizes, or a no-op when the browser refuses it. */
export const paneStorage: LayoutStorage = {
  getItem(key) {
    try {
      return window.localStorage.getItem(key);
    } catch {
      return null;
    }
  },
  setItem(key, value) {
    try {
      window.localStorage.setItem(key, value);
    } catch {
      /* storage full or blocked: sizes are a convenience */
    }
  },
};
