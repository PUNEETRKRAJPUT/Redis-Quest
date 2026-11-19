'use client';

import { clsx } from 'clsx';
import type { ReactNode } from 'react';
import { rankFor } from '../game/rank';
import type { SeasonTotals } from './model';

function Cell({
  label,
  children,
  className,
}: {
  label: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={clsx('flex min-w-0 flex-col justify-center px-5 py-3', className)}>
      <div className="label-caps text-[11px] text-chalk-dim">{label}</div>
      {children}
    </div>
  );
}

/** The scoreboard strip: XP, rank and the way to the next one, levels passed, match nights complete. */
export function Scoreboard({
  xp,
  totals,
  chapters,
}: {
  xp: number;
  totals: SeasonTotals;
  chapters: number;
}) {
  const r = rankFor(xp);
  const pct = Math.round(r.progress * 100);
  return (
    <div
      role="group"
      aria-label="Your score"
      className="grid grid-cols-2 divide-night-600/70 overflow-hidden rounded-lg border border-night-600/80 bg-night-950/70 shadow-[inset_0_1px_3px_rgb(0_0_0/0.5)] sm:grid-cols-[auto_minmax(200px,1fr)_auto_auto] sm:divide-x"
    >
      <Cell label="Total XP">
        <div className="flex items-baseline gap-1.5">
          <span
            data-testid="xp"
            className="font-display text-3xl font-bold leading-none tabular text-flood-400 [text-shadow:0_0_18px_rgb(255_154_31/0.45)]"
          >
            {xp}
          </span>
          <span className="label-caps text-xs text-chalk-dim">XP</span>
        </div>
      </Cell>
      <Cell label="Rank">
        <div className="truncate font-display text-xl font-semibold uppercase leading-tight tracking-[0.02em] text-chalk">
          {r.rank.title}
        </div>
        <div className="mt-1.5 flex items-center gap-2.5">
          <span
            role="progressbar"
            aria-label={r.next ? `Progress to ${r.next.title}` : 'Top rank reached'}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={pct}
            className="relative h-1.5 flex-1 overflow-hidden rounded-full bg-night-800"
          >
            <span
              className="absolute inset-y-0 left-0 rounded-full bg-[linear-gradient(90deg,var(--color-flood-600),var(--color-flood-400))] shadow-[0_0_10px_rgb(255_154_31/0.5)]"
              style={{ width: `${pct}%` }}
            />
          </span>
          <span className="whitespace-nowrap text-xs text-chalk-dim">
            {r.next ? `${r.toNext} XP to ${r.next.title}` : 'Top of the ladder'}
          </span>
        </div>
      </Cell>
      <Cell label="Levels passed">
        <div className="font-display text-2xl font-bold leading-none tabular text-chalk">
          {totals.passed}
          <span className="text-chalk-dim"> / {totals.total}</span>
        </div>
      </Cell>
      <Cell label="Match nights">
        <div className="font-display text-2xl font-bold leading-none tabular text-chalk">
          {totals.chaptersComplete}
          <span className="text-chalk-dim"> / {chapters}</span>
        </div>
      </Cell>
    </div>
  );
}
