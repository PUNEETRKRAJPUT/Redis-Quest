'use client';
// The level header: where you are (chapter, ball in the over), what this is (title, mode, reward), and how it
// stands (status, the interview clock).
import { clsx } from 'clsx';
import { ArrowLeft, Award, Code, Gavel, Laptop, SquareTerminal } from 'lucide-react';
import { Pill, type PillTone } from '../design';
import { Countdown } from '../level/interview';
import { QuestLink } from '../shell/QuestLink';
import type { LevelData, LevelStatus, Mode } from '../types';

export const MODE_LABEL: Record<Mode, string> = {
  cli: 'Terminal',
  code: 'Code',
  ops: 'Ops',
  decision: 'Decision',
};
const MODE_ICON = { cli: SquareTerminal, code: Code, ops: Laptop, decision: Gavel } as const;
const STATUS_TONE: Record<LevelStatus, PillTone> = {
  locked: 'neutral',
  available: 'sky',
  in_progress: 'flood',
  passed: 'turf',
};

export function LevelHeader({
  level,
  position,
}: {
  level: LevelData;
  /** 1-based place of the level in its chapter, and the chapter's size. */
  position: { n: number; of: number } | null;
}) {
  const ModeIcon = MODE_ICON[level.mode];
  const iv = level.interview;
  return (
    <header className="flex shrink-0 items-center gap-4 px-4 pb-3 pt-3">
      <QuestLink
        to="/"
        aria-label="Back to the season map"
        className={clsx(
          'grid size-10 shrink-0 place-items-center rounded-md border border-night-600 bg-night-900/80 text-chalk-dim',
          'transition-colors duration-fast hover:border-chalk-faint/60 hover:bg-night-800 hover:text-chalk',
        )}
      >
        <ArrowLeft size={18} aria-hidden />
      </QuestLink>
      <div className="min-w-0 flex-1">
        <nav aria-label="Breadcrumb" className="label-caps truncate text-xs text-chalk-dim">
          <QuestLink to="/" className="text-chalk-dim hover:text-chalk">
            Season map
          </QuestLink>
          <span aria-hidden className="mx-1.5 text-chalk-faint">
            /
          </span>
          <span>{level.chapterTitle}</span>
          {position ? (
            <>
              <span aria-hidden className="mx-1.5 text-chalk-faint">
                ·
              </span>
              <span className="tabular">
                Level {position.n} of {position.of}
              </span>
            </>
          ) : null}
        </nav>
        <div className="mt-0.5 flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1.5">
          <h1 className="m-0 truncate font-display text-[28px] font-bold uppercase leading-[1.05] tracking-[0.02em] text-chalk">
            {level.title}
          </h1>
          <div className="flex flex-wrap items-center gap-1.5">
            <Pill tone="sky" icon={<ModeIcon size={12} aria-hidden />}>
              {MODE_LABEL[level.mode]}
            </Pill>
            <Pill tone="flood">{level.reward.xp} XP</Pill>
            {level.reward.badge ? (
              <Pill tone="cap" icon={<Award size={12} aria-hidden />}>
                Badge: {level.reward.badge}
              </Pill>
            ) : null}
            {iv ? (
              <Pill tone="cap" data-testid="interview-pill">
                Interview: {iv.minutes} min, hints cost {iv.hintXpCost} XP
              </Pill>
            ) : null}
            {iv && iv.hintsBought > 0 ? (
              <Pill tone="flood" data-testid="hints-bought">
                Hints bought: {iv.hintsBought}
              </Pill>
            ) : null}
            {level.minRedisVersion ? <Pill>Redis {level.minRedisVersion}+</Pill> : null}
          </div>
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-3">
        <Countdown level={level} />
        <Pill
          variant="status"
          tone={STATUS_TONE[level.status]}
          live={level.status === 'in_progress'}
          data-testid="level-status"
        >
          {level.status.replace('_', ' ')}
        </Pill>
      </div>
    </header>
  );
}
