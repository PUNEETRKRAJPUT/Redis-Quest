// Motion vocabulary from the brief: durations, the `out` easing, springs for flips and cards, shared variants, and
// the one hook every animated component asks before it moves anything.
import { useSyncExternalStore } from 'react';
import type { Transition, Variants } from 'motion/react';
import { resolveReducedMotion, useSettings } from './settings';

/** Milliseconds, matching the --duration-* tokens. */
export const DURATION_MS = {
  instant: 90,
  fast: 150,
  base: 220,
  slow: 400,
  celebrate: 900,
} as const;
/** Seconds, for motion's `transition.duration`. */
export const DURATION = {
  instant: 0.09,
  fast: 0.15,
  base: 0.22,
  slow: 0.4,
  celebrate: 0.9,
} as const;

/** `out` in the brief: cubic-bezier(0.16, 1, 0.3, 1). */
export const EASE_OUT: [number, number, number, number] = [0.16, 1, 0.3, 1];
export const EASE_IN_OUT: [number, number, number, number] = [0.65, 0, 0.35, 1];

export const SPRING = {
  /** Scoreboard digits: stiff, a hint of overshoot, settles fast. */
  flip: { type: 'spring', stiffness: 520, damping: 34, mass: 0.9 },
  /** Cards and panels entering. */
  card: { type: 'spring', stiffness: 380, damping: 32 },
  /** Small things that pop: pills, badges, toasts. */
  pop: { type: 'spring', stiffness: 600, damping: 30 },
} as const satisfies Record<string, Transition>;

/** Lists stagger by 30ms, capped at 10 items: item 11 and later arrive with item 10. */
export const STAGGER_MS = 30;
export const STAGGER_CAP = 10;
export const staggerDelay = (index: number): number =>
  (Math.min(Math.max(index, 0), STAGGER_CAP - 1) * STAGGER_MS) / 1000;

/** Reduced motion: fades of 150ms at most, no movement. */
const FADE_ONLY: Transition = { duration: DURATION.fast, ease: EASE_OUT };

export const fade: Variants = {
  hidden: { opacity: 0 },
  show: { opacity: 1, transition: { duration: DURATION.base, ease: EASE_OUT } },
  exit: { opacity: 0, transition: { duration: DURATION.fast, ease: EASE_OUT } },
};

export const rise: Variants = {
  hidden: { opacity: 0, y: 10 },
  show: { opacity: 1, y: 0, transition: { duration: DURATION.slow, ease: EASE_OUT } },
  exit: { opacity: 0, y: 6, transition: { duration: DURATION.fast, ease: EASE_OUT } },
};

export const pop: Variants = {
  hidden: { opacity: 0, scale: 0.92 },
  show: { opacity: 1, scale: 1, transition: SPRING.pop },
  exit: { opacity: 0, scale: 0.96, transition: { duration: DURATION.fast, ease: EASE_OUT } },
};

/** Container + item for staggered lists. The item reads its index through `custom` so the cap holds. */
export const list: Variants = { hidden: {}, show: {}, exit: {} };
export const listItem: Variants = {
  hidden: { opacity: 0, y: 8 },
  show: (i: number = 0) => ({
    opacity: 1,
    y: 0,
    transition: { duration: DURATION.slow, ease: EASE_OUT, delay: staggerDelay(i) },
  }),
  exit: { opacity: 0, transition: { duration: DURATION.fast } },
};

const stripMovement = (target: unknown): unknown => {
  if (typeof target === 'function') {
    return (...args: unknown[]) => stripMovement((target as (...a: unknown[]) => unknown)(...args));
  }
  if (!target || typeof target !== 'object') return target;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(target as Record<string, unknown>)) {
    if (['x', 'y', 'scale', 'scaleX', 'scaleY', 'rotate', 'rotateX', 'rotateY'].includes(k))
      continue;
    out[k] = k === 'transition' ? FADE_ONLY : v;
  }
  if ('opacity' in out && !('transition' in out)) out.transition = FADE_ONLY;
  return out;
};

/** Pure: the same variants with every transform removed and every transition a 150ms fade. */
export function reduceVariants(v: Variants): Variants {
  const out: Variants = {};
  for (const [k, target] of Object.entries(v)) out[k] = stripMovement(target) as Variants[string];
  return out;
}

/** Picks the full or the reduced variants. */
export const variantsFor = (v: Variants, reduced: boolean): Variants =>
  reduced ? reduceVariants(v) : v;

const QUERY = '(prefers-reduced-motion: reduce)';
function subscribeOs(cb: () => void) {
  if (typeof window === 'undefined' || !window.matchMedia) return () => {};
  const mq = window.matchMedia(QUERY);
  mq.addEventListener('change', cb);
  return () => mq.removeEventListener('change', cb);
}
const osSnapshot = () => typeof window !== 'undefined' && !!window.matchMedia?.(QUERY).matches;

/** True when the OS asks for less motion. False on the server. */
export function useOsReducedMotion(): boolean {
  return useSyncExternalStore(subscribeOs, osSnapshot, () => false);
}

/** True when this player should see no movement: the in-game setting, or the OS when the setting is `system`. */
export function useReducedMotion(): boolean {
  const setting = useSettings((s) => s.reducedMotion);
  const os = useOsReducedMotion();
  return resolveReducedMotion(setting, os);
}

/** Outside React (canvas effects, imperative calls): the same resolution, read once. */
export function isReducedMotionNow(): boolean {
  return resolveReducedMotion(useSettings.getState().reducedMotion, osSnapshot());
}
