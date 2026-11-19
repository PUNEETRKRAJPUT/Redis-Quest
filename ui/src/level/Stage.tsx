'use client';
// One beat of a level, drawn as a node on a vertical timeline. The heading button is the first button in the
// section (the e2e helpers open a stage through it), and the body only exists while the stage is open.
import { clsx } from 'clsx';
import { Check, ChevronDown, Lock } from 'lucide-react';
import type { ReactNode } from 'react';
import { Pill, type PillTone } from '../design';

export type StageTone = 'neutral' | 'done' | 'warn' | 'locked';

const CHIP_TONE: Record<StageTone, PillTone> = {
  neutral: 'neutral',
  done: 'turf',
  warn: 'flood',
  locked: 'neutral',
};

export function Stage({
  n,
  title,
  chip,
  tone = 'neutral',
  open,
  onToggle,
  last = false,
  children,
}: {
  n: number;
  title: string;
  chip?: string;
  tone?: StageTone;
  open: boolean;
  onToggle: () => void;
  /** The last node on its rail: the line stops at the node. */
  last?: boolean;
  children: ReactNode;
}) {
  const bodyId = `stage-body-${n}`;
  return (
    <section
      className="group/stage relative pl-12 pr-3"
      data-testid={`stage-${n}`}
      data-open={open ? 'true' : 'false'}
    >
      <span
        aria-hidden
        className={clsx(
          'absolute left-[23px] top-0 w-px',
          last ? 'h-6' : 'bottom-0',
          tone === 'done' ? 'bg-turf/30' : 'bg-night-600/80',
        )}
      />
      <h2 className="m-0">
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={open}
          aria-controls={bodyId}
          className={clsx(
            'group/head flex min-h-12 w-full cursor-pointer items-center gap-3 rounded-md py-2.5 pr-2 text-left',
            'transition-colors duration-fast hover:bg-night-800/60',
          )}
        >
          <span
            aria-hidden
            className={clsx(
              'absolute left-[10px] grid size-[27px] place-items-center rounded-full border font-display text-md font-bold tabular',
              'transition-[border-color,background-color,box-shadow,color] duration-base',
              tone === 'done'
                ? 'border-turf/60 bg-turf/15 text-turf'
                : tone === 'locked'
                  ? 'border-night-600 bg-night-900 text-chalk-faint'
                  : open
                    ? 'border-flood-500 bg-flood-500/15 text-flood-400 shadow-[0_0_14px_-2px_rgb(255_154_31/0.65)]'
                    : tone === 'warn'
                      ? 'border-flood-500/60 bg-night-900 text-flood-400'
                      : 'border-night-600 bg-night-900 text-chalk-dim group-hover/head:border-chalk-faint',
            )}
          >
            {tone === 'done' ? (
              <Check size={14} strokeWidth={3} />
            ) : tone === 'locked' ? (
              <Lock size={12} />
            ) : (
              n
            )}
          </span>
          <span
            className={clsx(
              'min-w-0 flex-1 truncate font-display text-lg font-semibold uppercase tracking-[0.04em]',
              open ? 'text-chalk' : 'text-chalk-dim group-hover/head:text-chalk',
            )}
          >
            <span className="sr-only">Step {n}: </span>
            {title}
          </span>
          {chip ? (
            <Pill tone={CHIP_TONE[tone]} size="sm">
              {chip}
            </Pill>
          ) : null}
          <ChevronDown
            size={16}
            aria-hidden
            className={clsx(
              'shrink-0 text-chalk-faint transition-transform duration-base ease-out-expo',
              open ? 'rotate-0' : '-rotate-90',
            )}
          />
        </button>
      </h2>
      {open ? (
        <div id={bodyId} className="pb-6 pt-1">
          {children}
        </div>
      ) : null}
    </section>
  );
}
