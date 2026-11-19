'use client';
// The review's state machine, on top of the level's own verify flow (which it only watches, never changes):
// idle -> pending (the button was pressed) -> verdict (the big screen shows it) -> done (back to work).
// Under reduced motion there is no big screen: pending goes straight to done when the answer is in.
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { Verdict, VerifyResponse } from '../types';
import { HOLD_MS, revealAt, type Phase } from './decision';

export function useDecision({
  verifying,
  result,
  reduced,
  onReveal,
  onSettle,
}: {
  verifying: boolean;
  result: VerifyResponse | null;
  reduced: boolean;
  /** The moment the decision lands: sound, celebration. */
  onReveal: (v: Verdict) => void;
  /** The big screen is gone: move focus to the next step. */
  onSettle: (v: Verdict) => void;
}) {
  const [phase, setPhase] = useState<Phase>('idle');
  const clickAt = useRef(0);
  const resultAt = useRef<number | null>(null);
  const cb = useRef({ onReveal, onSettle });
  useLayoutEffect(() => {
    cb.current = { onReveal, onSettle };
  });

  const start = useCallback(() => {
    clickAt.current = performance.now();
    resultAt.current = null;
    setPhase('pending');
  }, []);

  useEffect(() => {
    if (result && resultAt.current === null) resultAt.current = performance.now();
  }, [result]);

  // Reveal once the verify flow has finished (answer and reload), no earlier than the review's minimum.
  useEffect(() => {
    if (phase !== 'pending' || verifying) return;
    if (!result) {
      setPhase('idle');
      return;
    }
    const at = revealAt(clickAt.current, resultAt.current ?? performance.now(), reduced);
    const t = setTimeout(
      () => {
        cb.current.onReveal(result.verdict);
        if (reduced) {
          setPhase('done');
          cb.current.onSettle(result.verdict);
        } else setPhase('verdict');
      },
      Math.max(0, at - performance.now()),
    );
    return () => clearTimeout(t);
  }, [phase, verifying, result, reduced]);

  const dismiss = useCallback(() => {
    setPhase((p) => (p === 'verdict' ? 'done' : p));
  }, []);

  // The decision holds for a moment, then gets out of the way.
  useEffect(() => {
    if (phase !== 'verdict' || !result) return;
    const t = setTimeout(dismiss, HOLD_MS[result.verdict] ?? 1200);
    return () => clearTimeout(t);
  }, [phase, result, dismiss]);

  const settled = useRef<VerifyResponse | null>(null);
  useEffect(() => {
    if (phase === 'done' && result && !reduced && settled.current !== result) {
      settled.current = result;
      cb.current.onSettle(result.verdict);
    }
  }, [phase, result, reduced]);

  return { phase, start, dismiss, revealed: phase !== 'pending' };
}
