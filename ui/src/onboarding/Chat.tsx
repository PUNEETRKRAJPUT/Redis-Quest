'use client';
// Self-contained chat bubbles for the opening scene. Deliberately not the chapter thread component: this one has
// no dependencies beyond the design tokens.
import { clsx } from 'clsx';
import { motion } from 'motion/react';
import { DURATION, EASE_OUT, SPRING } from '../design';
import { speakerFor, type Speaker } from './scene';
import type { ThreadMessage } from '../types';

const AVATAR: Record<Speaker['tone'], string> = {
  sky: 'bg-sky/15 text-sky border-sky/40',
  cap: 'bg-cap-purple/15 text-cap-purple border-cap-purple/40',
  flood: 'bg-flood-500/15 text-flood-400 border-flood-500/40',
  dim: 'bg-night-700 text-chalk-dim border-night-600',
};
const NAME: Record<Speaker['tone'], string> = {
  sky: 'text-sky',
  cap: 'text-cap-purple',
  flood: 'text-flood-400',
  dim: 'text-chalk-dim',
};

export function Avatar({ speaker }: { speaker: Speaker }) {
  return (
    <span
      aria-hidden
      className={clsx(
        'grid size-8 shrink-0 place-items-center rounded-full border font-display text-sm font-semibold',
        AVATAR[speaker.tone],
      )}
    >
      {speaker.initials}
    </span>
  );
}

export function Bubble({
  message,
  reduced,
  instant,
}: {
  message: ThreadMessage;
  reduced: boolean;
  /** Already on screen when the scene is skipped: no entrance. */
  instant?: boolean;
}) {
  const speaker = speakerFor(message.from);
  const mine = message.from === 'you';
  return (
    <motion.li
      data-testid="welcome-line"
      layout={reduced ? false : 'position'}
      initial={instant || reduced ? false : { opacity: 0, y: 14, scale: 0.97 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={reduced ? { duration: DURATION.fast } : SPRING.pop}
      className={clsx('flex items-end gap-2.5', mine && 'flex-row-reverse')}
    >
      <Avatar speaker={speaker} />
      <div className={clsx('flex max-w-[78%] flex-col gap-1', mine && 'items-end')}>
        <span className={clsx('label-caps text-xs tracking-[0.12em]', NAME[speaker.tone])}>
          {speaker.name}
        </span>
        <p
          className={clsx(
            'm-0 rounded-lg px-3.5 py-2 font-sans text-md leading-[1.45] text-chalk',
            mine
              ? 'rounded-br-xs border border-flood-500/35 bg-flood-500/12'
              : 'rounded-bl-xs border border-night-600 bg-night-800',
          )}
        >
          {message.text}
          <span className="tabular ml-2 inline-block align-baseline text-xs text-chalk-dim">
            {message.time}
          </span>
        </p>
      </div>
    </motion.li>
  );
}

export function Typing({ speaker, reduced }: { speaker: Speaker; reduced: boolean }) {
  const mine = speaker.name === 'You';
  return (
    <motion.li
      layout={reduced ? false : 'position'}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0, transition: { duration: DURATION.instant, ease: EASE_OUT } }}
      className={clsx('flex items-end gap-2.5', mine && 'flex-row-reverse')}
      aria-hidden
    >
      <Avatar speaker={speaker} />
      <span className="flex h-9 items-center gap-1 rounded-lg border border-night-600 bg-night-800 px-3.5">
        {[0, 1, 2].map((i) => (
          <span
            key={i}
            className="ds-still size-1.5 animate-typing rounded-full bg-chalk-dim"
            style={{ animationDelay: `${i * 160}ms` }}
          />
        ))}
      </span>
    </motion.li>
  );
}
