'use client';
// The arrival state machine of a thread: which messages are on screen, who is typing, skip and replay.
// Timing comes from logic.ts; this file only schedules it and keeps React state.
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { play, useReducedMotion } from '../design';
import {
  MAX_REVEAL_MS,
  MIN_TYPING_MS,
  contentHash,
  needsChoice,
  planReveal,
  readPicks,
  readSeen,
  shouldPlay,
  shouldPlayCue,
  writePicks,
  writeSeen,
  type AnimateMode,
  type ChoiceMessage,
  type Picks,
} from './logic';

export type RevealOptions = {
  messages: ChoiceMessage[];
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
  /** Index of the player's message that is waiting for a pick (its chips are showing), or null. */
  askIndex: number | null;
  /** What the player picked so far (message index to choice index). Skipped messages have no entry. */
  picks: Picks;
  /** Pick choice `choice` of the message at `index`: remembers it and lets the arrival go on. */
  choose: (index: number, choice: number) => void;
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
  // The player's own lines can carry choices: the arrival waits at such a line until one is picked. Picks come back
  // from localStorage after mount (the server render shows each line's first choice, which is its own text).
  const [picks, setPicks] = useState<Picks>({});
  const [askAt, setAskAt] = useState<number | null>(null);
  const lastCue = useRef<number | null>(null);
  const onRevealedRef = useRef(onRevealed);
  // The latest messages, for effects that must not restart just because the caller passed a new array.
  const messagesRef = useRef(messages);
  useEffect(() => {
    onRevealedRef.current = onRevealed;
    messagesRef.current = messages;
  });

  // Decide once per thread content (and again if the player turns on reduced motion mid-way).
  useLayoutEffect(() => {
    const go = shouldPlay({ mode, seen: persist && readSeen(hash), reduced, count });
    setLive(go);
    setPlaying(go);
    setShown(go ? 0 : count);
    setTypingAt(null);
    setAskAt(null);
    setPicks(persist ? readPicks(hash, messagesRef.current) : {});
  }, [hash, mode, reduced, count, persist]);

  const finish = useCallback(() => {
    setShown(count);
    setPlaying(false);
    setTypingAt(null);
    setAskAt(null);
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
    if (needsChoice(messagesRef.current, shown, picks)) {
      // The player's turn: a quiet beat, then the chips. No typing dots and no timer for the message itself.
      const ask = window.setTimeout(() => setAskAt(shown), step.gapMs);
      return () => window.clearTimeout(ask);
    }
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
  }, [playing, visible, shown, count, plan, finish, picks]);

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

  const choose = useCallback(
    (index: number, choice: number) => {
      setPicks((prev) => {
        const next = { ...prev, [index]: choice };
        if (persist) writePicks(hash, next);
        return next;
      });
      setAskAt(null);
    },
    [hash, persist],
  );

  return {
    shown,
    playing,
    typingIndex: playing && typingAt === shown ? shown : null,
    askIndex: playing && askAt !== null && askAt === shown ? shown : null,
    picks,
    choose,
    live,
    reduced,
    skip: finish,
    replay,
    watch: setObserved,
  };
}
