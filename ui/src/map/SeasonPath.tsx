'use client';

import { clsx } from 'clsx';
import { Check, Lock } from 'lucide-react';
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useReducedMotion } from '@/design';
import type { ChapterSummary } from '../types';
import { BallStrip } from './BallStrip';
import { CampusScene } from './CampusScene';
import s from './map.module.css';
import { fixtureState, matchNumber, passedIn, type FixtureState, type NextMatch } from './model';

// useLayoutEffect warns on the server; the screen renders on the client, but unit tests render to static markup.
const useIsoLayoutEffect = typeof window === 'undefined' ? useEffect : useLayoutEffect;

interface Point {
  x: number;
  y: number;
}

/** The road between two fixtures: a low arch along a row, a wide bend around the end of a row. */
export function segmentPath(a: Point, b: Point, width: number, bend: number): string {
  if (Math.abs(a.y - b.y) < 4) {
    const dx = b.x - a.x;
    return `M${a.x} ${a.y} C${a.x + dx / 3} ${a.y - 34} ${a.x + (2 * dx) / 3} ${b.y - 34} ${b.x} ${b.y}`;
  }
  const side = a.x > width / 2 ? 1 : -1;
  return `M${a.x} ${a.y} C${a.x + side * bend} ${a.y} ${b.x + side * bend} ${b.y} ${b.x} ${b.y}`;
}

/** Grid placement for a serpentine: odd rows run right to left, so the road never jumps back. */
function cell(index: number, cols: number) {
  const row = Math.floor(index / cols);
  const pos = index % cols;
  return { gridRow: row + 1, gridColumn: (row % 2 ? cols - pos : pos + 1) as number };
}

const STATE_WORDS: Record<FixtureState, string> = {
  complete: 'Complete',
  current: 'Now playing',
  open: 'Open',
  upcoming: 'Locked',
};

function Node({ index, state }: { index: number; state: FixtureState }) {
  return (
    <span
      aria-hidden="true"
      className="absolute left-1/2 top-0 z-10 grid size-11 -translate-x-1/2 -translate-y-1/2 place-items-center"
    >
      {state === 'current' && (
        <>
          <span
            className={clsx('ds-still absolute inset-0 rounded-full bg-flood-500/40', s.ping)}
          />
          <span className="label-caps absolute bottom-full left-1/2 mb-2 -translate-x-1/2 whitespace-nowrap rounded-full bg-flood-500 px-2 py-0.5 text-[10px] leading-4 text-on-flood shadow-[0_0_14px_rgb(255_154_31/0.6)]">
            Next up
          </span>
        </>
      )}
      <span
        className={clsx(
          'relative grid size-full place-items-center rounded-full font-display text-lg font-bold tabular leading-none',
          state === 'complete' &&
            'bg-[radial-gradient(circle_at_35%_30%,var(--color-flood-400),var(--color-flood-600))] text-on-flood shadow-[0_0_0_3px_var(--color-night-950),0_0_22px_rgb(255_154_31/0.6)]',
          state === 'current' &&
            'bg-night-900 text-flood-400 shadow-[0_0_0_3px_var(--color-night-950),inset_0_0_0_2px_var(--color-flood-500),0_0_26px_rgb(255_154_31/0.55)]',
          state === 'open' &&
            'bg-night-800 text-chalk shadow-[0_0_0_3px_var(--color-night-950),inset_0_0_0_2px_var(--color-chalk-dim)]',
          state === 'upcoming' &&
            'bg-night-900 text-chalk-faint shadow-[0_0_0_3px_var(--color-night-950),inset_0_0_0_1px_var(--color-night-600)]',
        )}
      >
        {index + 1}
        {state === 'complete' && (
          <span className="absolute -right-1 -top-1 grid size-[18px] place-items-center rounded-full bg-turf text-night-950 shadow-[0_0_0_2px_var(--color-night-950)]">
            <Check size={12} strokeWidth={3.2} />
          </span>
        )}
        {state === 'upcoming' && (
          <span className="absolute -right-1 -top-1 grid size-[18px] place-items-center rounded-full bg-night-800 text-chalk-faint shadow-[0_0_0_2px_var(--color-night-950)]">
            <Lock size={10} strokeWidth={2.6} />
          </span>
        )}
      </span>
    </span>
  );
}

function Fixture({
  chapter,
  index,
  state,
  currentId,
  selected,
  onSelect,
  placement,
}: {
  chapter: ChapterSummary;
  index: number;
  state: FixtureState;
  currentId: string | null;
  selected: boolean;
  onSelect: (id: string) => void;
  placement: { gridRow: number; gridColumn: number };
}) {
  const passed = passedIn(chapter);
  const total = chapter.levels.length;
  const head = chapter.incident[0];
  const dim = state === 'upcoming';
  return (
    <li
      data-testid={`chapter-${chapter.id}`}
      data-fixture=""
      data-state={state}
      style={placement}
      className={clsx(
        'group/fx relative flex min-w-0 hover:z-20 focus-within:z-20 flex-col rounded-lg border px-4 pb-4 pt-8 transition-[border-color,box-shadow,transform,background-color] duration-base ease-out-expo motion-ok:hover:-translate-y-0.5',
        state === 'complete' &&
          'border-flood-500/30 bg-[linear-gradient(180deg,rgb(255_154_31/0.12),rgb(17_24_51/0.92)_45%)] shadow-[inset_0_1px_0_rgb(255_179_71/0.2),0_18px_40px_-22px_rgb(255_154_31/0.5)]',
        state === 'current' &&
          'border-flood-500/70 bg-[radial-gradient(120%_70%_at_50%_0%,rgb(255_154_31/0.16),rgb(11_16_32/0.94)_60%)] shadow-[inset_0_1px_0_rgb(255_179_71/0.25),0_0_0_1px_rgb(255_154_31/0.15),0_24px_60px_-24px_rgb(255_154_31/0.65)]',
        state === 'open' && 'border-night-600 bg-night-900/90 shadow-raise',
        dim && 'border-night-600/60 bg-night-950/80 shadow-hairline',
        selected && 'outline outline-2 outline-offset-2 outline-sky/80',
        'hover:border-chalk-faint/60',
      )}
    >
      <Node index={index} state={state} />
      <div className="flex items-center justify-between gap-2">
        <span className="label-caps text-[11px] text-chalk-dim">Match {matchNumber(index)}</span>
        <span
          className={clsx(
            'label-caps text-[11px]',
            state === 'complete' && 'text-turf',
            state === 'current' && 'text-flood-400',
            state === 'open' && 'text-sky',
            dim && 'text-chalk-dim',
          )}
        >
          {STATE_WORDS[state]}
        </span>
      </div>
      <h3 className="mt-1 font-display text-xl font-bold uppercase leading-tight tracking-[0.02em] text-chalk">
        {/* the whole card is the hit area; the balls sit above it */}
        <button
          type="button"
          aria-expanded={selected}
          aria-controls="fixture-detail"
          onClick={() => onSelect(chapter.id)}
          className="cursor-pointer text-left after:absolute after:inset-0 after:rounded-lg after:content-[''] focus-visible:outline-none focus-visible:after:outline focus-visible:after:outline-2 focus-visible:after:outline-offset-2 focus-visible:after:outline-sky"
        >
          {chapter.title}
        </button>
      </h3>
      {head ? (
        <p
          className={clsx(
            'mt-1.5 line-clamp-2 text-sm leading-snug',
            dim ? 'text-chalk-dim/80' : 'text-chalk-dim',
          )}
        >
          <span className="sr-only">Incident: </span>“{head.text}”
        </p>
      ) : null}
      <div className="relative z-10 mt-auto pt-4 focus-within:z-20 hover:z-20">
        <BallStrip levels={chapter.levels} currentId={currentId} chapterTitle={chapter.title} />
      </div>
      <div className="mt-3 flex items-center gap-3">
        <span className="relative h-1 flex-1 overflow-hidden rounded-full bg-night-800">
          <span
            className={clsx(
              'absolute inset-y-0 left-0 rounded-full',
              state === 'complete' ? 'bg-turf' : 'bg-flood-500',
            )}
            style={{ width: `${total ? (passed / total) * 100 : 0}%` }}
          />
        </span>
        <span className="tabular whitespace-nowrap text-xs text-chalk-dim">
          {passed} of {total}
        </span>
      </div>
    </li>
  );
}

/**
 * The season as a floodlit road across a night campus. Fixtures sit on the road in a serpentine; the road is lit
 * up to where the player is and drawn as a faint dashed track beyond. The road is measured from the cards, so it
 * stays exact at any width.
 */
export function SeasonPath({
  chapters,
  next,
  selectedId,
  onSelect,
}: {
  chapters: ChapterSummary[];
  next: NextMatch | null;
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  const grid = useRef<HTMLOListElement>(null);
  const [cols, setCols] = useState(4);
  const [geo, setGeo] = useState<{ w: number; h: number; pts: Point[]; card: number } | null>(null);
  const reduced = useReducedMotion();

  const measure = useCallback(() => {
    const el = grid.current;
    if (!el || el.offsetWidth === 0) return;
    setCols(el.offsetWidth >= 860 ? 4 : 2);
    const cards = [...el.querySelectorAll<HTMLElement>('[data-fixture]')];
    setGeo({
      w: el.offsetWidth,
      h: el.offsetHeight,
      card: cards[0]?.offsetWidth ?? 240,
      // offsets ignore transforms, so hover lifts and entrance motion never bend the road
      pts: cards.map((c) => ({ x: c.offsetLeft + c.offsetWidth / 2, y: c.offsetTop })),
    });
  }, []);

  useIsoLayoutEffect(() => {
    measure();
    const el = grid.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [measure, chapters.length, cols]);

  const states = chapters.map((c, i) => fixtureState(c, next?.chapterIndex === i));
  const complete = states.filter((x) => x === 'complete').length;
  // The campus lights up with the season: one beam at the start, all four when the season is won.
  const lit = Math.min(4, 1 + Math.floor((complete / Math.max(1, chapters.length)) * 4));

  return (
    <div className="relative overflow-hidden rounded-xl border border-night-600/80 shadow-raise">
      <CampusScene lit={lit} />
      <div className="relative px-6 pb-20 pt-12 lg:px-14">
        {geo && (
          <svg
            aria-hidden="true"
            focusable="false"
            className="pointer-events-none absolute left-6 top-12 overflow-visible lg:left-14"
            width={geo.w}
            height={geo.h}
          >
            <defs>
              <filter id="road-glow" x="-20%" y="-50%" width="140%" height="200%">
                <feGaussianBlur stdDeviation="6" />
              </filter>
            </defs>
            {geo.pts.slice(1).map((b, i) => {
              const a = geo.pts[i]!;
              const d = segmentPath(a, b, geo.w, geo.card * 0.9);
              const from = chapters[i]!;
              const fromState = states[i]!;
              // Fully lit after a complete fixture; partly lit out of the current one, by how far it got.
              const frac =
                fromState === 'complete'
                  ? 1
                  : fromState === 'current' && from.levels.length
                    ? passedIn(from) / from.levels.length
                    : 0;
              return (
                <g key={i}>
                  <path
                    d={d}
                    fill="none"
                    stroke="var(--color-night-600)"
                    strokeWidth="2"
                    strokeDasharray="4 12"
                    strokeLinecap="round"
                    className={clsx('ds-still', !reduced && s.march)}
                  />
                  {frac > 0 && (
                    <>
                      <path
                        d={d}
                        pathLength={1}
                        fill="none"
                        stroke="var(--color-flood-500)"
                        strokeOpacity="0.55"
                        strokeWidth="10"
                        strokeDasharray={`${frac} 1`}
                        filter="url(#road-glow)"
                      />
                      <path
                        d={d}
                        pathLength={1}
                        fill="none"
                        stroke="var(--color-flood-400)"
                        strokeWidth="3"
                        strokeLinecap="round"
                        strokeDasharray={`${frac} 1`}
                      />
                    </>
                  )}
                </g>
              );
            })}
          </svg>
        )}
        <ol
          ref={grid}
          aria-label="Season fixtures"
          className={clsx(
            'relative grid gap-x-5 gap-y-16',
            cols === 4 ? 'grid-cols-4' : 'grid-cols-2',
          )}
        >
          {chapters.map((c, i) => (
            <Fixture
              key={c.id}
              chapter={c}
              index={i}
              state={states[i]!}
              currentId={next?.chapter.id === c.id ? next.level.id : null}
              selected={selectedId === c.id}
              onSelect={onSelect}
              placement={cell(i, cols)}
            />
          ))}
        </ol>
      </div>
    </div>
  );
}
