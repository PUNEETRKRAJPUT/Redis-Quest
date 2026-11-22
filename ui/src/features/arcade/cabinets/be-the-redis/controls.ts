// Which key does what, as a pure function so it can be tested without a keyboard.
export type Phase = 'ready' | 'playing' | 'paused' | 'over';
export type Intent = 'start' | 'run' | 'swap' | 'pause' | 'resume' | 'restart';

/**
 * Space is the one big action: start, then run the next command, or resume. At the end of a round Space does
 * nothing, so a player still tapping it does not restart by accident; Enter and R do.
 */
export function intentFor(key: string, phase: Phase): Intent | null {
  const k = key.length === 1 ? key.toLowerCase() : key;
  if (k === ' ' || k === 'Spacebar') {
    if (phase === 'ready') return 'start';
    if (phase === 'playing') return 'run';
    if (phase === 'paused') return 'resume';
    return null;
  }
  if (k === 'Enter') {
    if (phase === 'ready') return 'start';
    if (phase === 'playing') return 'run';
    if (phase === 'paused') return 'resume';
    return 'restart';
  }
  if (k === 's') return phase === 'playing' ? 'swap' : null;
  if (k === 'p' || k === 'Escape') {
    if (phase === 'playing') return 'pause';
    if (phase === 'paused') return 'resume';
    return null;
  }
  if (k === 'r') return phase === 'ready' ? null : 'restart';
  return null;
}
