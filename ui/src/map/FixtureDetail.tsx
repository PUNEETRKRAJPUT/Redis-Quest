'use client';

import { clsx } from 'clsx';
import {
  ChevronRight,
  Code,
  Lock,
  MessagesSquare,
  Scale,
  Server,
  SquareTerminal,
} from 'lucide-react';
import { useLayoutEffect, useState, type ReactNode } from 'react';
import { Button, Card, Dialog, Pill, ProgressBar } from '@/design';
import { ballFor } from '../game/outcome';
import { nameOf, Thread } from '../level/Thread';
import { QuestLink } from '../shell/QuestLink';
import type { ChapterSummary, LevelStatus, Mode } from '../types';
import { BallFace } from './BallStrip';
import { fixtureState, matchNumber, modeLabel, passedIn, type MapLevel } from './model';

const MODE_ICON: Record<Mode, ReactNode> = {
  cli: <SquareTerminal size={13} aria-hidden="true" />,
  code: <Code size={13} aria-hidden="true" />,
  ops: <Server size={13} aria-hidden="true" />,
  decision: <Scale size={13} aria-hidden="true" />,
};

// The visible status words are the old map's, so "Passed" and "Locked" read the same to tests and players.
const STATUS_LABEL: Record<LevelStatus, string> = {
  locked: 'Locked',
  available: 'Ready',
  in_progress: 'In progress',
  passed: 'Passed',
};
const STATUS_TONE = {
  locked: 'neutral',
  available: 'flood',
  in_progress: 'flood',
  passed: 'turf',
} as const;

function LevelRow({ level, n, current }: { level: MapLevel; n: number; current: boolean }) {
  const locked = level.status === 'locked';
  const ball = ballFor(level.status, level.attempts);
  const body = (
    <>
      <span className="w-6 shrink-0 text-right font-display text-md font-semibold tabular text-chalk-dim">
        {n}
      </span>
      <BallFace ball={ball} current={current} />
      <span className="min-w-0 flex-1">
        <span
          className={clsx(
            'block truncate text-md font-medium',
            locked ? 'text-chalk-dim' : 'text-chalk',
          )}
        >
          {level.title}
        </span>
        <span className="sr-only">. {ball.label}. </span>
      </span>
      <span className="hidden items-center gap-1 text-xs text-chalk-dim sm:inline-flex">
        {MODE_ICON[level.mode as Mode] ?? null}
        {modeLabel(level.mode)}
      </span>
      <span className="w-14 shrink-0 text-right font-mono text-xs tabular text-chalk-dim">
        {level.xp} XP
      </span>
      <Pill
        size="sm"
        variant="status"
        tone={STATUS_TONE[level.status]}
        live={level.status === 'in_progress'}
        className="w-[92px] justify-center"
      >
        {STATUS_LABEL[level.status]}
      </Pill>
      {locked ? (
        <Lock size={14} aria-hidden="true" className="shrink-0 text-chalk-faint" />
      ) : (
        <ChevronRight
          size={16}
          aria-hidden="true"
          className="shrink-0 text-chalk-faint transition-transform duration-fast group-hover/row:text-flood-400 motion-ok:group-hover/row:translate-x-0.5"
        />
      )}
    </>
  );
  const row =
    'group/row flex items-center gap-3 rounded-md border px-3 py-2 no-underline transition-[background-color,border-color] duration-fast';
  return (
    <li className="break-inside-avoid pb-1.5">
      {locked ? (
        <span
          aria-disabled="true"
          data-testid={`level-${level.id}`}
          className={clsx(row, 'cursor-not-allowed border-transparent bg-night-950/40')}
        >
          {body}
        </span>
      ) : (
        <QuestLink
          to={{ name: 'level', id: level.id }}
          data-testid={`level-${level.id}`}
          prefetch={false}
          className={clsx(
            row,
            'cursor-pointer',
            current
              ? 'border-flood-500/50 bg-flood-500/[0.07] hover:bg-flood-500/[0.12]'
              : 'border-night-600/50 bg-night-900/60 hover:border-night-600 hover:bg-night-800',
          )}
        >
          {body}
        </QuestLink>
      )}
    </li>
  );
}

/** One chapter opened up: every level as a row, and the chapter's chat thread on demand. */
export function FixtureDetail({
  chapter,
  index,
  currentId,
  hidden,
}: {
  chapter: ChapterSummary;
  index: number;
  currentId: string | null;
  hidden?: boolean;
}) {
  const [threadOpen, setThreadOpen] = useState(false);
  // Next keeps this route mounted while hidden: a dialog left open must not greet the player on return.
  useLayoutEffect(() => () => setThreadOpen(false), []);
  const passed = passedIn(chapter);
  const total = chapter.levels.length;
  const state = fixtureState(chapter, currentId !== null);
  return (
    <Card
      padding="none"
      hidden={hidden}
      id={hidden ? undefined : 'fixture-detail'}
      data-testid={`fixture-${chapter.id}`}
      aria-label={`Match ${index + 1}: ${chapter.title}`}
      role="region"
      className="overflow-hidden"
    >
      <header className="flex flex-wrap items-center gap-x-5 gap-y-3 border-b border-night-600/70 bg-night-950/30 px-5 py-4">
        <div className="min-w-0 flex-1">
          <div className="label-caps text-[11px] text-chalk-dim">
            Match {matchNumber(index)} ·{' '}
            {state === 'complete' ? 'Complete' : state === 'upcoming' ? 'Locked' : 'In play'}
          </div>
          <h2 className="mt-0.5 font-display text-2xl font-bold uppercase tracking-[0.02em] text-chalk">
            {chapter.title}
          </h2>
          {chapter.incident[0] ? (
            <p className="mt-0.5 truncate text-sm text-chalk-dim">
              {nameOf(chapter.incident[0].from)}: “{chapter.incident[0].text}”
            </p>
          ) : null}
        </div>
        <div className="w-60 shrink-0">
          <ProgressBar
            value={passed}
            max={Math.max(1, total)}
            label="Levels passed"
            valueText={`${passed} of ${total}`}
            tone={state === 'complete' ? 'turf' : 'flood'}
            size="sm"
          />
        </div>
        {chapter.incident.length ? (
          <Button
            variant="ghost"
            size="sm"
            leading={<MessagesSquare size={14} aria-hidden="true" />}
            aria-haspopup="dialog"
            aria-expanded={threadOpen}
            onClick={() => setThreadOpen(true)}
          >
            Read the chapter thread
          </Button>
        ) : null}
      </header>
      <ol className="gap-x-6 p-4 lg:columns-2" aria-label={`${chapter.title} levels`}>
        {chapter.levels.map((l, i) => (
          <LevelRow key={l.id} level={l} n={i + 1} current={l.id === currentId} />
        ))}
      </ol>
      {chapter.incident.length ? (
        <Dialog
          open={threadOpen}
          onClose={() => setThreadOpen(false)}
          title={chapter.title}
          description={`The chat that started match ${index + 1}.`}
          size="md"
        >
          <div className="max-h-[60vh] overflow-y-auto">
            {threadOpen ? (
              <Thread messages={chapter.incident} label={`${chapter.title} thread`} />
            ) : null}
          </div>
        </Dialog>
      ) : null}
    </Card>
  );
}
