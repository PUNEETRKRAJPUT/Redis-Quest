import { Award } from 'lucide-react';
import { ArrowRight } from 'lucide-react';
import { Card, FlipNumber, Pill, ProgressBar } from '../design';
import { rankFor } from '../game/rank';
import type { ImpactFigure } from '../impact';
import { Jersey } from './Jersey';

export interface PlayerCardProps {
  name: string;
  xp: number;
  badges: string[];
  passed: number;
  total: number;
  chaptersDone: number;
  chaptersTotal: number;
  /** CSS colour of the jersey. */
  jersey: string;
  win: { title: string; figure: ImpactFigure } | null;
}

function Stat({
  label,
  children,
  hint,
}: {
  label: string;
  children: React.ReactNode;
  hint?: React.ReactNode;
}) {
  return (
    <div className="flex min-w-0 flex-col gap-1.5 rounded-md border border-night-600/70 bg-night-950/50 px-4 py-3">
      <span className="label-caps text-[11px] text-chalk-dim">{label}</span>
      <span className="tabular flex items-baseline gap-1.5 font-display text-2xl font-bold leading-none text-chalk">
        {children}
      </span>
      {hint ? <span className="truncate text-xs text-chalk-dim">{hint}</span> : null}
    </div>
  );
}

/** The one loud thing on the career page: who you are in the league, in numbers the save backs. */
export function PlayerCard({
  name,
  xp,
  badges,
  passed,
  total,
  chaptersDone,
  chaptersTotal,
  jersey,
  win,
}: PlayerCardProps) {
  const r = rankFor(xp);
  return (
    <Card focal padding="lg" data-testid="player-card" aria-label={`${name}, ${r.rank.title}`}>
      <div className="grid items-center gap-x-8 gap-y-6 md:grid-cols-[auto_minmax(0,1fr)] xl:grid-cols-[auto_minmax(0,1fr)_auto]">
        <div className="flex justify-center md:justify-start">
          <Jersey color={jersey} name={name} number={passed} />
        </div>
        <div className="min-w-0">
          <div className="label-caps text-xs text-chalk-dim">Player card</div>
          <h2
            data-testid="player-name"
            className="mt-1 truncate font-display text-3xl font-bold uppercase leading-none tracking-[0.02em] text-chalk"
          >
            {name}
          </h2>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <Pill tone="flood" variant="status" data-testid="player-rank">
              {r.rank.title}
            </Pill>
            <span className="text-sm text-chalk-dim">
              {r.next
                ? `${r.toNext.toLocaleString('en-US')} XP to ${r.next.title}`
                : 'Top of the ladder'}
            </span>
          </div>
          <ProgressBar
            className="mt-4 max-w-md"
            label="Progress to the next rank"
            showLabel={false}
            value={r.progress * 100}
            max={100}
            valueText={r.next ? `${Math.round(r.progress * 100)}%` : 'complete'}
          />
        </div>
        <div className="flex flex-col items-start gap-1.5 md:col-span-2 xl:col-span-1 xl:items-end">
          <span className="label-caps text-xs text-chalk-dim">Experience</span>
          <FlipNumber value={xp} minDigits={4} size="xl" tone="flood" label="XP" sound={false} />
          <span className="label-caps text-sm text-flood-400">XP</span>
        </div>
      </div>

      <div className="rule-fade my-6" aria-hidden />

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Stat label="Levels passed" hint={`${total - passed} still ahead`}>
          {passed}
          <span className="text-lg text-chalk-dim">/ {total}</span>
        </Stat>
        <Stat label="Chapters finished" hint="every level in it passed">
          {chaptersDone}
          <span className="text-lg text-chalk-dim">/ {chaptersTotal}</span>
        </Stat>
        <Stat label="Caps earned" hint={badges.length === 0 ? 'none yet' : 'collected so far'}>
          {badges.length}
        </Stat>
        <Stat
          label="Biggest measured win"
          hint={win ? `${win.figure.label}, ${win.title}` : 'a load-test level will show it'}
        >
          {win && win.figure.before !== undefined ? (
            <>
              <span className="text-lg text-chalk-faint line-through">{win.figure.before}</span>
              <ArrowRight size={16} aria-hidden className="self-center text-chalk-dim" />
              <span className="text-turf">{win.figure.value}</span>
              {win.figure.unit ? (
                <span className="text-base text-chalk-dim">{win.figure.unit}</span>
              ) : null}
            </>
          ) : (
            <span className="text-chalk-faint">–</span>
          )}
        </Stat>
      </div>

      <ul aria-label="Badges earned" className="mt-5 flex flex-wrap gap-2">
        {badges.length === 0 ? (
          <li className="text-sm text-chalk-dim">no badges yet</li>
        ) : (
          badges.map((b) => (
            <li key={b}>
              <Pill tone="cap" icon={<Award size={13} aria-hidden />}>
                {b}
              </Pill>
            </li>
          ))
        )}
      </ul>
    </Card>
  );
}
