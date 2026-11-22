'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { celebrate, EmptyState, Skeleton, toast } from '@/design';
import { useQuest } from '@/store';
import { matchdayApi } from './api';
import { FixtureView } from './FixtureView';
import { liveFigures, parseSeedInput, randomSeed, secondsLeft, startErrorCopy } from './model';
import { ScorecardView } from './ScorecardView';
import type { MatchdayOverview, MatchStatus } from './types';
import { WarRoom } from './WarRoom';

const POLL_MS = 1000;

/** /matchday: the fixture card, the war room while a match runs, and the final scorecard. */
export function MatchDayScreen() {
  const [overview, setOverview] = useState<MatchdayOverview | null>(null);
  const [status, setStatus] = useState<MatchStatus | null>(null);
  const [fetchedAt, setFetchedAt] = useState(0);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [startError, setStartError] = useState<string | null>(null);
  const [seed, setSeed] = useState<number | null>(null); // null: today's
  const [seedText, setSeedText] = useState('');
  const [seedProblem, setSeedProblem] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const [stopping, setStopping] = useState(false);
  const [showCard, setShowCard] = useState(false);
  const [copied, setCopied] = useState(false);
  const [, tick] = useState(0);
  const alive = useRef(true);
  const wasRunning = useRef(false);

  const ticks = useQuest((s) => s.ticks);
  const lastEvent = useQuest((s) => s.events[s.events.length - 1]);

  const refreshOverview = useCallback(async (forSeed: number | null) => {
    try {
      const o = await matchdayApi.overview(forSeed ?? undefined);
      if (!alive.current) return;
      setOverview(o);
      setLoadError(null);
    } catch (err) {
      if (alive.current) setLoadError(startErrorCopy(err));
    }
  }, []);

  const refreshStatus = useCallback(async () => {
    try {
      const s = await matchdayApi.status();
      if (!alive.current) return;
      setStatus(s);
      setFetchedAt(Date.now());
    } catch {
      // The engine may be restarting: the next poll tries again.
    }
  }, []);

  useEffect(() => {
    alive.current = true;
    void refreshOverview(null);
    void refreshStatus();
    return () => {
      alive.current = false;
    };
  }, [refreshOverview, refreshStatus]);

  const running = status?.state === 'running';

  // While a match runs: poll once a second and let the clock tick; the engine's level events refresh sooner.
  useEffect(() => {
    if (!running) return;
    const id = setInterval(() => {
      tick((n) => n + 1);
      void refreshStatus();
    }, POLL_MS);
    return () => clearInterval(id);
  }, [running, refreshStatus]);

  useEffect(() => {
    if (lastEvent?.name?.startsWith('matchday_')) void refreshStatus();
  }, [lastEvent, refreshStatus]);

  // The moment a match ends: show its scorecard, refresh the best list, and cheer a finished innings.
  useEffect(() => {
    if (running) {
      wasRunning.current = true;
      return;
    }
    if (wasRunning.current && status?.state === 'finished') {
      wasRunning.current = false;
      setShowCard(true);
      void refreshOverview(seed);
      if (status.result?.endedBy === 'complete') celebrate({ cue: 'roar' });
    }
  }, [running, status, seed, refreshOverview]);

  const start = async () => {
    setStartError(null);
    setStarting(true);
    try {
      const s = await matchdayApi.start(seed ?? undefined);
      setStatus(s);
      setFetchedAt(Date.now());
      setShowCard(false);
    } catch (err) {
      setStartError(startErrorCopy(err));
      void refreshOverview(seed);
    } finally {
      if (alive.current) setStarting(false);
    }
  };

  const stop = async () => {
    setStopping(true);
    try {
      await matchdayApi.stop();
    } catch (err) {
      toast.error('Could not stop the match', startErrorCopy(err));
    } finally {
      await refreshStatus();
      if (alive.current) setStopping(false);
    }
  };

  const useSeed = () => {
    const n = parseSeedInput(seedText);
    if (n === null) {
      setSeedProblem('A seed is a whole number from 1 to 2147483647.');
      return;
    }
    setSeedProblem(null);
    setSeed(n);
    void refreshOverview(n);
  };
  const useToday = () => {
    setSeed(null);
    setSeedProblem(null);
    setSeedText('');
    void refreshOverview(null);
  };
  const random = () => {
    const n = randomSeed();
    setSeedText(String(n));
    setSeedProblem(null);
    setSeed(n);
    void refreshOverview(n);
  };

  const copy = async () => {
    const text = status?.result?.text;
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => alive.current && setCopied(false), 2000);
    } catch {
      toast.warn(
        'Could not copy',
        'Select the text under "The scorecard as plain text" and copy it by hand.',
      );
    }
  };

  if (loadError && !overview)
    return (
      <EmptyState title="Match Day is not available">
        <span role="alert">{loadError}</span>
      </EmptyState>
    );
  if (!overview || !status)
    return <Skeleton className="h-64 w-full" lines={4} label="Loading Match Day" />;

  if (running)
    return (
      <WarRoom
        status={status}
        figures={liveFigures(ticks, Date.now())}
        secondsLeft={secondsLeft(status.overEndsAt, status.now, fetchedAt, Date.now())}
        stopping={stopping}
        onStop={() => void stop()}
      />
    );

  if (showCard && status.state === 'finished' && status.result)
    return (
      <ScorecardView
        status={status}
        machineNote={overview.machineNote}
        copied={copied}
        onCopy={() => void copy()}
        onBack={() => setShowCard(false)}
      />
    );

  return (
    <FixtureView
      overview={overview}
      seedLabel={seed === null ? 'today' : 'other'}
      seedText={seedText}
      seedProblem={seedProblem}
      starting={starting}
      error={startError}
      hasLastMatch={status.state === 'finished' && status.result !== null}
      onSeedText={setSeedText}
      onRandom={random}
      onUseSeed={useSeed}
      onUseToday={useToday}
      onStart={() => void start()}
      onShowLast={() => setShowCard(true)}
    />
  );
}
