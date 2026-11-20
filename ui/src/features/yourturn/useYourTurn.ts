'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useQuest } from '@/store';
import { fetchCoverage, fetchEvents } from './client';
import {
  EMPTY_STATE,
  STORAGE_KEY,
  markPullRequest,
  parseState,
  pickCommand,
  playtestFromEvents,
  recordPlaytest,
  type Coverage,
  type YourTurnState,
} from './logic';

function readStored(): YourTurnState {
  try {
    return parseState(localStorage.getItem(STORAGE_KEY));
  } catch {
    return EMPTY_STATE; // storage can be blocked: the path still works for this visit
  }
}

function writeStored(s: YourTurnState): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(s));
  } catch {
    /* blocked storage: nothing to remember it with */
  }
}

/** Progress through "Your turn", remembered in localStorage, with steps one and two ticking themselves. */
export function useYourTurn() {
  const [state, setState] = useState<YourTurnState>(EMPTY_STATE);
  const [ready, setReady] = useState(false);
  const events = useQuest((s) => s.events);
  const loaded = useRef(false);

  useEffect(() => {
    setState(readStored());
    loaded.current = true;
    setReady(true);
  }, []);

  useEffect(() => {
    if (loaded.current) writeStored(state);
  }, [state]);

  // Step two ticks when a play-test passes after the command was picked: from the live events the store already
  // holds (the player was in the studio, not here), and from the engine's ring when the page was reloaded since.
  useEffect(() => {
    if (!ready || !state.command || state.playtest) return;
    const live = playtestFromEvents(events, state.pickedAt);
    if (live) setState((s) => recordPlaytest(s, live));
  }, [ready, events, state.command, state.pickedAt, state.playtest]);

  useEffect(() => {
    if (!ready || !state.command || state.playtest) return;
    let cancelled = false;
    void fetchEvents().then((recorded) => {
      const found = playtestFromEvents(recorded, state.pickedAt);
      if (found && !cancelled) setState((s) => recordPlaytest(s, found));
    });
    return () => {
      cancelled = true;
    };
  }, [ready, state.command, state.pickedAt, state.playtest]);

  const pick = useCallback((command: string) => {
    setState((s) => pickCommand(s, command, new Date()));
  }, []);
  const openedPullRequest = useCallback(() => {
    setState((s) => markPullRequest(s, new Date()));
  }, []);
  const startOver = useCallback(() => setState(EMPTY_STATE), []);

  return { state, ready, pick, openedPullRequest, startOver };
}

/** The board's data, fetched on mount and again on demand; null while the first answer is on its way. */
export function useCoverage() {
  const [coverage, setCoverage] = useState<Coverage | null>(null);
  const load = useCallback(() => {
    setCoverage(null);
    void fetchCoverage().then(setCoverage);
  }, []);
  useEffect(() => {
    let cancelled = false;
    void fetchCoverage().then((c) => {
      if (!cancelled) setCoverage(c);
    });
    return () => {
      cancelled = true;
    };
  }, []);
  return { coverage, reload: load };
}
