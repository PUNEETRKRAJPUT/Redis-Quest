'use client';

import { clsx } from 'clsx';
import { ballFor, type Ball } from '../game/outcome';
import { QuestLink } from '../shell/QuestLink';
import s from './map.module.css';
import { overs, type MapLevel } from './model';
import { useRoving } from './roving';

const FACE: Record<Ball['tone'], string> = {
  six: 'bg-[radial-gradient(circle_at_35%_30%,var(--color-flood-400),var(--color-flood-600))] text-on-flood shadow-[0_0_10px_rgb(255_154_31/0.55)]',
  four: 'bg-[radial-gradient(circle_at_35%_30%,#8ad8ff,#2f9fdc)] text-night-950 shadow-[0_0_10px_rgb(92_200_255/0.45)]',
  run: 'bg-night-700 text-chalk ring-1 ring-chalk-dim/60',
  live: 'bg-flood-500/15 ring-2 ring-flood-500',
  next: 'bg-night-900 border-[1.5px] border-dashed border-flood-400/90',
  locked: 'bg-night-800 ring-1 ring-night-600',
};

/** One level as a ball. The face is decoration; the label is the level and how it went, in plain words. */
export function BallFace({
  ball,
  current,
  size = 'md',
}: {
  ball: Ball;
  current?: boolean;
  size?: 'sm' | 'md' | 'lg';
}) {
  const box =
    size === 'lg'
      ? 'size-7 text-sm'
      : size === 'sm'
        ? 'size-4 text-[10px]'
        : 'size-[18px] text-[11px]';
  return (
    <span aria-hidden="true" className={clsx('relative grid shrink-0 place-items-center', box)}>
      {current && (
        <span className={clsx('ds-still absolute inset-0 rounded-full bg-flood-500/50', s.ping)} />
      )}
      <span
        className={clsx(
          'relative grid size-full place-items-center rounded-full font-display font-bold leading-none tabular',
          FACE[ball.tone],
        )}
      >
        {ball.symbol}
        {ball.tone === 'live' && <span className="size-1.5 rounded-full bg-flood-400" />}
        {ball.tone === 'locked' && <span className="size-1 rounded-full bg-night-600" />}
      </span>
    </span>
  );
}

/**
 * A chapter's levels as balls in overs of six. One tab stop for the whole strip; arrow keys, Home and End move
 * between balls (fast hands without ninety-six tab stops on the page). Unlocked balls open their level.
 */
export function BallStrip({
  levels,
  currentId,
  chapterTitle,
}: {
  levels: MapLevel[];
  currentId: string | null;
  chapterTitle: string;
}) {
  const { ref, onKeyDown, item } = useRoving<HTMLDivElement>(
    levels.length,
    levels.findIndex((l) => l.id === currentId),
  );
  let n = 0;
  return (
    <div
      ref={ref}
      role="group"
      aria-label={`${chapterTitle}: levels as balls, use the arrow keys`}
      onKeyDown={onKeyDown}
      className="flex flex-wrap items-center gap-x-2.5 gap-y-1.5"
    >
      {overs(levels).map((over, oi) => (
        <span
          key={oi}
          role="group"
          aria-label={`Over ${oi + 1}`}
          className="flex items-center gap-[3px] rounded-full bg-night-950/55 px-1 py-[3px] shadow-[inset_0_1px_2px_rgb(0_0_0/0.5)]"
        >
          {over.map((l) => {
            const i = n++;
            const ball = ballFor(l.status, l.attempts);
            const label = `Level ${i + 1}, ${l.title}: ${ball.label}`;
            const common = {
              ...item(i),
              'aria-label': label,
              className:
                'group/ball relative grid rounded-full outline-offset-1 transition-transform duration-fast ease-out-expo motion-ok:hover:-translate-y-0.5',
            };
            const body = (
              <>
                <BallFace ball={ball} current={l.id === currentId} />
                <span
                  aria-hidden="true"
                  className="pointer-events-none absolute bottom-full left-1/2 z-30 mb-2 -translate-x-1/2 whitespace-nowrap rounded-sm border border-night-600 bg-night-800 px-2 py-1 text-xs font-medium text-chalk opacity-0 shadow-pop transition-opacity duration-fast group-hover/ball:opacity-100 group-focus-visible/ball:opacity-100"
                >
                  <span className="text-chalk-dim">{i + 1}.</span> {l.title}
                  <span className="text-chalk-dim"> · {ball.label}</span>
                </span>
              </>
            );
            return l.status === 'locked' ? (
              <span
                key={l.id}
                role="img"
                {...common}
                className={clsx(common.className, 'cursor-default')}
              >
                {body}
              </span>
            ) : (
              <QuestLink
                key={l.id}
                to={{ name: 'level', id: l.id }}
                prefetch={false}
                {...common}
                className={clsx(common.className, 'cursor-pointer')}
              >
                {body}
              </QuestLink>
            );
          })}
        </span>
      ))}
    </div>
  );
}
