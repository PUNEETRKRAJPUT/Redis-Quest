'use client';

import { motion } from 'motion/react';
import { CloudRain, RefreshCw } from 'lucide-react';
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import {
  Button,
  Card,
  EmptyState,
  Skeleton,
  listItem,
  play,
  useReducedMotion,
  variantsFor,
} from '@/design';
import { CapsShelf } from '../map/CapsShelf';
import { FixtureDetail } from '../map/FixtureDetail';
import { nextMatch, seasonTotals } from '../map/model';
import { NextMatchCard, SeasonCompleteCard } from '../map/NextMatchCard';
import { Scoreboard } from '../map/Scoreboard';
import { SeasonPath } from '../map/SeasonPath';
import { useQuest } from '../store';

// useLayoutEffect warns during static rendering (unit tests); in the browser it runs before paint.
const useIsoLayoutEffect = typeof window === 'undefined' ? useEffect : useLayoutEffect;

function Rise({ i, children, className }: { i: number; children: ReactNode; className?: string }) {
  const reduced = useReducedMotion();
  return (
    <motion.div
      variants={variantsFor(listItem, reduced)}
      custom={i}
      initial="hidden"
      animate="show"
      className={className}
    >
      {children}
    </motion.div>
  );
}

/** Loading and failure share the frame of the map, so nothing jumps when the season arrives. */
function MapFrame({ name, children }: { name: string; children: ReactNode }) {
  return (
    <main data-ds="" className="mx-auto w-full max-w-[1360px] px-4 pb-16 pt-6 sm:px-6">
      <h1 className="font-display text-3xl font-bold uppercase tracking-[0.02em] text-chalk">
        Hello, {name}
      </h1>
      {children}
    </main>
  );
}

/**
 * The home screen: the league season on a night campus. It answers "what do I play next?" first (the hero),
 * then shows the whole season as a floodlit road of match nights, one fixture opened up, and the caps shelf.
 */
export function ChapterMap() {
  const chapters = useQuest((s) => s.chapters);
  const progress = useQuest((s) => s.progress);
  const refreshChapters = useQuest((s) => s.refreshChapters);
  const [picked, setPicked] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const [retrying, setRetrying] = useState(false);
  const detailRef = useRef<HTMLDivElement>(null);
  const reduced = useReducedMotion();

  // Next keeps this route mounted while hidden; coming back, the map opens on the next match again.
  useIsoLayoutEffect(() => () => setPicked(null), []);

  // The store swallows a failed chapters request and leaves `chapters` null. Ask once more ourselves: if that
  // also leaves it null, the season cannot be loaded and the map says so instead of loading forever.
  const haveChapters = chapters !== null;
  useEffect(() => {
    if (haveChapters || !progress) return;
    let live = true;
    void refreshChapters().then(() => {
      if (live && !useQuest.getState().chapters) setFailed(true);
    });
    return () => {
      live = false;
    };
  }, [haveChapters, progress, refreshChapters]);

  const retry = async () => {
    setRetrying(true);
    await refreshChapters();
    setRetrying(false);
    if (useQuest.getState().chapters) setFailed(false);
  };

  if (!progress)
    return (
      <main data-ds="" className="mx-auto w-full max-w-[1360px] px-4 pt-6 sm:px-6">
        <p className="text-md text-chalk-dim">Loading the map...</p>
      </main>
    );

  if (!chapters) {
    return (
      <MapFrame name={progress.player.name}>
        {failed ? (
          <Card padding="none" className="mt-6" data-testid="map-error" role="alert">
            <EmptyState
              icon={<CloudRain size={24} aria-hidden="true" />}
              title="Rain delay on the fixture list"
              action={
                <Button
                  variant="primary"
                  leading={<RefreshCw size={16} aria-hidden="true" />}
                  loading={retrying}
                  onClick={() => void retry()}
                >
                  Try again
                </Button>
              }
            >
              The chapters could not be loaded from the game engine. Your progress is safe. Check
              that the stack is running, then try again.
            </EmptyState>
          </Card>
        ) : (
          <div className="mt-6 grid gap-5" aria-busy="true">
            <p className="sr-only">Loading the map...</p>
            <Skeleton className="h-[86px] w-full rounded-lg" label="Loading the scoreboard" />
            <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_360px]">
              <Skeleton className="h-[250px] w-full rounded-lg" label="Loading the next match" />
              <Skeleton className="h-[250px] w-full rounded-lg" label="Loading your caps" />
            </div>
            <Skeleton className="h-[560px] w-full rounded-xl" label="Loading the season" />
          </div>
        )}
      </MapFrame>
    );
  }

  const list = chapters.chapters;
  const next = nextMatch(list);
  const totals = seasonTotals(list);
  const fallback =
    list.find((c) => c.levels.some((l) => l.status !== 'passed')) ?? list[list.length - 1];
  const selectedId = picked ?? next?.chapter.id ?? fallback?.id ?? null;

  const select = (id: string) => {
    setPicked(id);
    play('tick');
    // The opened fixture sits under the map: bring it into view if it is below the fold.
    requestAnimationFrame(() =>
      detailRef.current?.scrollIntoView({
        block: 'nearest',
        behavior: reduced ? 'auto' : 'smooth',
      }),
    );
  };

  return (
    <main
      data-ds=""
      data-testid="chapter-map"
      className="mx-auto w-full max-w-[1360px] px-4 pb-16 pt-6 sm:px-6"
    >
      <Rise i={0} className="flex flex-wrap items-end justify-between gap-x-8 gap-y-4">
        <div className="min-w-0">
          <div className="label-caps text-xs text-flood-400">Season fixtures · Hostel league</div>
          <h1 className="mt-1 font-display text-3xl font-bold uppercase tracking-[0.02em] text-chalk">
            Hello, {progress.player.name}
          </h1>
          <p className="mt-1 max-w-xl text-md text-chalk-dim">
            Pick up where you left off. Each level is one incident with a real Redis answer.
          </p>
        </div>
        <Scoreboard xp={progress.xp} totals={totals} chapters={list.length} />
      </Rise>

      <div className="mt-6 grid gap-5 lg:grid-cols-[minmax(0,1fr)_360px]">
        <Rise i={1} className="min-w-0">
          {next ? (
            <NextMatchCard next={next} total={list.length} />
          ) : (
            <SeasonCompleteCard xp={progress.xp} />
          )}
        </Rise>
        <Rise i={2} className="min-w-0">
          <CapsShelf badges={progress.badges} />
        </Rise>
      </div>

      <Rise i={3} className="mt-10">
        <section aria-labelledby="season-title">
          <div className="mb-4 flex flex-wrap items-end justify-between gap-x-6 gap-y-2">
            <div>
              <h2
                id="season-title"
                className="font-display text-2xl font-bold uppercase tracking-[0.02em] text-chalk"
              >
                The season
              </h2>
              <p className="text-sm text-chalk-dim">
                Eight match nights on campus. Pick one to see its levels; each ball is one level.
              </p>
            </div>
            <BallLegend />
          </div>
          <SeasonPath chapters={list} next={next} selectedId={selectedId} onSelect={select} />
        </section>
      </Rise>

      <Rise i={4} className="mt-6">
        <div ref={detailRef} className="scroll-mt-24">
          {list.map((c, i) => (
            <FixtureDetail
              key={c.id}
              chapter={c}
              index={i}
              currentId={next?.chapter.id === c.id ? next.level.id : null}
              hidden={c.id !== selectedId}
            />
          ))}
        </div>
      </Rise>
    </main>
  );
}

function BallLegend() {
  const items: [string, ReactNode][] = [
    [
      'Passed first time',
      <span
        key="6"
        className="grid size-4 place-items-center rounded-full bg-flood-500 font-display text-[10px] font-bold text-on-flood"
      >
        6
      </span>,
    ],
    [
      'Second try',
      <span
        key="4"
        className="grid size-4 place-items-center rounded-full bg-sky font-display text-[10px] font-bold text-night-950"
      >
        4
      </span>,
    ],
    [
      'More tries',
      <span
        key="1"
        className="grid size-4 place-items-center rounded-full bg-night-700 font-display text-[10px] font-bold text-chalk ring-1 ring-chalk-dim/60"
      >
        1
      </span>,
    ],
    [
      'Ready',
      <span
        key="r"
        className="size-4 rounded-full border-[1.5px] border-dashed border-flood-400"
      />,
    ],
    ['Locked', <span key="l" className="size-4 rounded-full bg-night-800 ring-1 ring-night-600" />],
  ];
  return (
    <ul aria-label="What the balls mean" className="flex flex-wrap items-center gap-x-4 gap-y-1.5">
      {items.map(([label, face]) => (
        <li key={label} className="flex items-center gap-1.5 text-xs text-chalk-dim">
          <span aria-hidden="true" className="inline-flex">
            {face}
          </span>
          {label}
        </li>
      ))}
    </ul>
  );
}
