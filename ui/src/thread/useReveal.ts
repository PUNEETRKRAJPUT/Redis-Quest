'use client';
// The arrival state machine of a thread: which messages are on screen, who is typing, skip and replay.
// Timing comes from logic.ts; this file only schedules it and keeps React state.
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { play, useReducedMotion } from '../design';
import type { ThreadMessage } from '../types';
import {
  MAX_REVEAL_MS,
  MIN_TYPING_MS,
  contentHash,
  planReveal,
  readSeen,
  shouldPlay,
  shouldPlayCue,
  writeSeen,
  type AnimateMode,
} from './logic';

export type RevealOptions = {
  messages: ThreadMessage[];
  mode: AnimateMode;
  maxMs?: number;
  /** Remember a finished arrival in localStorage (default true). */
  persist?: boolean;
  onRevealed?: () => void;
};

export type Reveal = {
  /** Number of messages on screen. */
  shown: number;
  playing: boolean;
  /** Index of the message whose typing dots are showing, or null. */
  typingIndex: number | null;
  /** Messages after this index arrived live and animate in; earlier ones were there from the start. */
  live: boolean;
  reduced: boolean;
  skip: () => void;
  replay: () => void;
  /** Attach to the element that must be on screen for the arrival to run. */
  watch: (el: Element | null) => void;
};

export function useReveal({
  messages,
  mode,
  maxMs = MAX_REVEAL_MS,
  persist = true,
  onRevealed,
}: RevealOptions): Reveal {
  const count = messages.length;
  const hash = useMemo(() => contentHash(messages), [messages]);
  const plan = useMemo(() => planReveal(messages, maxMs), [messages, maxMs]);
  const reduced = useReducedMotion();

  // Server render and hydration show everything (readable without JS); the layout effect below rewinds to the
  // start before the first paint when this thread should play.
  const [shown, setShown] = useState(count);
  const [playing, setPlaying] = useState(false);
  const [live, setLive] = useState(false);
  const [typingAt, setTypingAt] = useState<number | null>(null);
  const [visible, setVisible] = useState(false);
  const lastCue = useRef<number | null>(null);
  const onRevealedRef = useRef(onRevealed);
  useEffect(() => {
    onRevealedRef.current = onRevealed;
  });

  // Decide once per thread content (and again if the player turns on reduced motion mid-way).
  useLayoutEffect(() => {
    const go = shouldPlay({ mode, seen: persist && readSeen(hash), reduced, count });
    setLive(go);
    setPlaying(go);
    setShown(go ? 0 : count);
    setTypingAt(null);
  }, [hash, mode, reduced, count, persist]);

  const finish = useCallback(() => {
    setShown(count);
    setPlaying(false);
    setTypingAt(null);
    if (persist && mode !== 'never') writeSeen(hash);
    onRevealedRef.current?.();
  }, [count, hash, mode, persist]);

  // Visibility gate: an arrival inside a closed <details> or below the fold waits for the player to look.
  const [observed, setObserved] = useState<Element | null>(null);
  useEffect(() => {
    if (!observed) return;
    if (typeof IntersectionObserver === 'undefined') {
      setVisible(true);
      return;
    }
    const io = new IntersectionObserver(
      (entries) => setVisible(entries.some((e) => e.isIntersecting)),
      { threshold: 0.15 },
    );
    io.observe(observed);
    return () => io.disconnect();
  }, [observed]);

  // The clock: a quiet gap, then the typing dots, then the message lands (with its cue).
  useEffect(() => {
    if (!playing || !visible) return;
    if (shown >= count) {
      finish();
      return;
    }
    const step = plan.steps[shown];
    if (!step) return;
    const showDots = step.typingMs >= MIN_TYPING_MS;
    const t1 = window.setTimeout(() => {
      if (showDots) setTypingAt(shown);
    }, step.gapMs);
    const t2 = window.setTimeout(() => {
      setShown(shown + 1);
      const now = performance.now();
      if (shouldPlayCue(now, lastCue.current)) {
        lastCue.current = now;
        play('msg');
      }
    }, step.gapMs + step.typingMs);
    return () => {
      window.clearTimeout(t1);
      window.clearTimeout(t2);
    };
  }, [playing, visible, shown, count, plan, finish]);

  // Escape reveals everything. Only listens while an arrival is running, and never swallows the key.
  useEffect(() => {
    if (!playing) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !e.defaultPrevented) finish();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [playing, finish]);

  const replay = useCallback(() => {
    if (reduced || count === 0) return;
    lastCue.current = null;
    setLive(true);
    setShown(0);
    setTypingAt(null);
    setPlaying(true);
  }, [reduced, count]);

  return {
    shown,
    playing,
    typingIndex: playing && typingAt === shown ? shown : null,
    live,
    reduced,
    skip: finish,
    replay,
    watch: setObserved,
  };
}
