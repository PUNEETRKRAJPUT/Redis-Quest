// Celebration effects are fired imperatively ("on demand") from anywhere, and drawn by host components mounted
// once (<Confetti />, <Floodlights />, both inside DesignRuntime). A tiny event bus joins the two.
import { isReducedMotionNow } from './motion';
import { play } from './sound';

export type ConfettiOptions = {
  /** Origin in viewport fractions; default the top centre of the screen. */
  x?: number;
  y?: number;
  /** Number of pieces, default 140. */
  count?: number;
  /** Spread in degrees around straight down-and-out, default 70. */
  spread?: number;
};

type Listener<T> = (payload: T) => void;
const confettiListeners = new Set<Listener<ConfettiOptions>>();
const floodListeners = new Set<Listener<void>>();

export function onConfetti(fn: Listener<ConfettiOptions>): () => void {
  confettiListeners.add(fn);
  return () => void confettiListeners.delete(fn);
}
export function onFloodlights(fn: Listener<void>): () => void {
  floodListeners.add(fn);
  return () => void floodListeners.delete(fn);
}

/** Bursts confetti. Does nothing under reduced motion (the brief: no confetti). */
export function confetti(options: ConfettiOptions = {}): void {
  if (isReducedMotionNow()) return;
  confettiListeners.forEach((fn) => fn(options));
}

/** Sweeps the floodlights across the screen; under reduced motion only a soft wash fades in and out. */
export function floodlights(): void {
  floodListeners.forEach((fn) => fn());
}

/** The pass moment from the brief: floodlights sweep, confetti bursts, `tock` plays. Flip your XP yourself. */
export function celebrate(
  options: { confetti?: ConfettiOptions; cue?: 'tock' | 'roar' } = {},
): void {
  floodlights();
  confetti(options.confetti);
  play(options.cue ?? 'tock');
}
