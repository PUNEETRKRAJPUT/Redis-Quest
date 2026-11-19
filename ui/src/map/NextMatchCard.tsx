'use client';

import { clsx } from 'clsx';
import { ArrowRight, Play, RotateCcw, Trophy } from 'lucide-react';
import { Card, Pill } from '@/design';
import { ballFor } from '../game/outcome';
import { nameOf } from '../level/Thread';
import { QuestLink } from '../shell/QuestLink';
import { BallFace } from './BallStrip';
import { matchNumber, modeLabel, overs, type NextMatch } from './model';

/** The primary button's look on a link: navigation stays a real link (middle-click, open in new tab). */
export const PRIMARY_LINK =
  'group/btn inline-flex h-12 shrink-0 cursor-pointer select-none items-center justify-center gap-2.5 whitespace-nowrap rounded-md bg-flood-500 px-6 font-sans text-base font-semibold text-on-flood no-underline ' +
  'shadow-[inset_0_1px_0_rgb(255_255_255/0.38),inset_0_-1px_0_rgb(0_0_0/0.2),0_1px_2px_rgb(0_0_0/0.5)] ' +
  'transition-[background-color,box-shadow,transform] duration-fast ease-out-expo ' +
  'hover:bg-flood-400 hover:shadow-[inset_0_1px_0_rgb(255_255_255/0.45),inset_0_-1px_0_rgb(0_0_0/0.2),0_10px_28px_-8px_rgb(255_154_31/0.6)] ' +
  'active:bg-flood-600 motion-ok:active:translate-y-px';

/** A floodlight beam falling into the card from a pylon just outside its top corner. */
function Beam({ side }: { side: 'left' | 'right' }) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 200 300"
      preserveAspectRatio="none"
      className={clsx(
        'pointer-events-none absolute top-0 h-full w-[38%]',
        side === 'left' ? 'left-0' : 'right-0 -scale-x-100',
      )}
    >
      <defs>
        <linearGradient id="nm-beam" x1="0" y1="0" x2="0.6" y2="1">
          <stop offset="0" stopColor="#FFB347" stopOpacity="0.22" />
          <stop offset="1" stopColor="#FF9A1F" stopOpacity="0" />
        </linearGradient>
        <radialGradient id="nm-lamp" cx="0.5" cy="0.5" r="0.5">
          <stop offset="0" stopColor="#FFE2A8" stopOpacity="0.55" />
          <stop offset="1" stopColor="#FF9A1F" stopOpacity="0" />
        </radialGradient>
      </defs>
      <polygon points="0,0 34,0 200,300 70,300" fill="url(#nm-beam)" />
      <ellipse cx="10" cy="0" rx="60" ry="40" fill="url(#nm-lamp)" />
    </svg>
  );
}

export function NextMatchCard({ next, total }: { next: NextMatch; total: number }) {
  const { chapter, chapterIndex, level, levelIndex, resume } = next;
  const head = chapter.incident[0];
  const passed = chapter.levels.filter((l) => l.status === 'passed').length;
  const over = Math.floor(levelIndex / 6);
  const thisOver = overs(chapter.levels)[over] ?? [];
  return (
    <Card
      focal
      padding="none"
      data-testid="next-match"
      aria-labelledby="next-match-title"
      className="overflow-hidden"
    >
      <Beam side="left" />
      <Beam side="right" />
      {/* the match number, huge and hollow, like a poster behind the copy */}
      <span
        aria-hidden="true"
        className="pointer-events-none absolute -bottom-14 right-[270px] select-none font-display text-[200px] font-bold leading-none text-transparent [-webkit-text-stroke:1.5px_rgb(255_154_31/0.09)] max-lg:hidden"
      >
        {matchNumber(chapterIndex)}
      </span>
      <div className="relative grid gap-6 p-6 md:grid-cols-[minmax(0,1fr)_auto] md:items-center md:p-7">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <Pill tone="flood" variant="status" live>
              Next match
            </Pill>
            <span className="label-caps text-xs text-chalk-dim">
              Match {matchNumber(chapterIndex)} of {String(total).padStart(2, '0')} ·{' '}
              {chapter.title}
            </span>
          </div>
          {head ? (
            <figure className="mt-4 max-w-3xl">
              <blockquote className="font-display text-2xl font-semibold leading-tight tracking-[0.01em] text-chalk md:text-[32px]">
                “{head.text}”
              </blockquote>
              <figcaption className="mt-1.5 text-sm text-chalk-dim">
                {nameOf(head.from)}, {head.time}
              </figcaption>
            </figure>
          ) : null}
          <div className="mt-5 flex flex-wrap items-center gap-x-4 gap-y-3">
            <QuestLink
              to={{ name: 'level', id: level.id }}
              className={PRIMARY_LINK}
              data-testid="next-match-play"
            >
              {resume ? (
                <RotateCcw size={18} aria-hidden="true" />
              ) : (
                <Play size={18} aria-hidden="true" className="fill-current" />
              )}
              {resume ? 'Continue' : 'Play'}
              <span className="sr-only">: {level.title}</span>
              <ArrowRight
                size={18}
                aria-hidden="true"
                className="transition-transform duration-fast motion-ok:group-hover/btn:translate-x-0.5"
              />
            </QuestLink>
            <div className="min-w-0">
              <div id="next-match-title" className="text-base font-semibold text-chalk">
                Level {levelIndex + 1}: {level.title}
              </div>
              <div className="mt-0.5 flex items-center gap-2 text-sm text-chalk-dim">
                <Pill size="sm">{modeLabel(level.mode)}</Pill>
                <Pill size="sm" tone="flood">
                  +{level.xp} XP
                </Pill>
                {resume ? <span>You started this one</span> : null}
              </div>
            </div>
          </div>
        </div>
        {/* the over being bowled, big: where this level sits in the chapter */}
        <div
          aria-hidden="true"
          className="relative hidden min-w-[220px] rounded-lg border border-night-600/80 bg-night-950/70 p-4 shadow-[inset_0_1px_3px_rgb(0_0_0/0.5)] md:block"
        >
          <div className="label-caps text-[11px] text-chalk-dim">This over</div>
          <div className="mt-2 flex gap-2">
            {thisOver.map((l) => (
              <BallFace
                key={l.id}
                ball={ballFor(l.status, l.attempts)}
                current={l.id === level.id}
                size="lg"
              />
            ))}
          </div>
          <div className="mt-4 flex items-baseline justify-between gap-4">
            <span className="label-caps text-[11px] text-chalk-dim">Chapter</span>
            <span className="tabular font-display text-xl font-bold text-chalk">
              {passed}
              <span className="text-chalk-dim">/{chapter.levels.length}</span>
            </span>
          </div>
        </div>
      </div>
    </Card>
  );
}

export function SeasonCompleteCard({ xp }: { xp: number }) {
  return (
    <Card focal padding="none" data-testid="season-complete" className="overflow-hidden">
      <Beam side="left" />
      <Beam side="right" />
      <div className="relative flex flex-col items-center px-6 py-9 text-center">
        <span className="grid size-16 place-items-center rounded-full bg-[radial-gradient(circle_at_35%_30%,var(--color-flood-400),var(--color-flood-600))] text-on-flood shadow-glow">
          <Trophy size={30} aria-hidden="true" />
        </span>
        <h2 className="mt-4 font-display text-3xl font-bold uppercase tracking-[0.02em] text-chalk">
          Season complete
        </h2>
        <p className="mt-2 max-w-xl text-base text-chalk-dim">
          Every match night is won, {xp} XP on the board. Replay any level from the season below, or
          open what you built.
        </p>
        <QuestLink to={{ name: 'built' }} className={clsx(PRIMARY_LINK, 'mt-5')}>
          See what you built
          <ArrowRight size={18} aria-hidden="true" />
        </QuestLink>
      </div>
    </Card>
  );
}
