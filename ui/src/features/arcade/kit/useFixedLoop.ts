'use client';

import { useEffect, useRef } from 'react';
import { advanceClock } from './loop';

/**
 * Calls `onSteps(n)` with the number of whole `stepMs` steps due, once per animation frame, while `active`.
 * Stops when `active` is false, when the tab is hidden and when the component unmounts.
 */
export function useFixedLoop(active: boolean, stepMs: number, onSteps: (steps: number) => void) {
  const handler = useRef(onSteps);
  useEffect(() => {
    handler.current = onSteps;
  });

  useEffect(() => {
    if (!active) return;
    let raf = 0;
    let last = performance.now();
    let acc = 0;
    const frame = (now: number) => {
      const r = advanceClock(acc, now - last, stepMs);
      last = now;
      acc = r.accMs;
      if (r.steps > 0) handler.current(r.steps);
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [active, stepMs]);
}
