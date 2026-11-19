'use client';
// Presentational pieces of the chat thread: avatar, bubble, typing indicator.
import { clsx } from 'clsx';
import { CheckCheck } from 'lucide-react';
import { motion } from 'motion/react';
import type { ThreadMessage } from '../types';
import { avatarTone, initials } from './logic';

/*
 * The e2e suite finds messages with `.thread .msg`, so the list keeps `thread` and the row keeps `msg`. The legacy
 * stylesheet is unlayered and has rules for both that beat any layered utility, so the resets are important
 * utilities. (CSS modules are not an option here: next.config.ts routes every *.css through the Tailwind loader,
 * which turns a .module.css into global CSS.) They become harmless when the legacy stylesheet is deleted.
 */
export const LIST_RESET =
  'm-0! p-0! list-none! flex! flex-col! gap-0! max-w-none! rounded-none! bg-transparent!';
const ROW_RESET =
  'flex! gap-2! self-stretch! border-0! bg-transparent! p-0! max-w-none! rounded-none!';

export function Avatar({ slug, name }: { slug: string; name: string }) {
  const tone = avatarTone(slug);
  return (
    <span
      aria-hidden="true"
      data-testid="thread-avatar"
      className={clsx(
        'inline-flex size-8 shrink-0 select-none items-center justify-center rounded-full font-display text-sm font-semibold uppercase tracking-[0.04em] ring-1 ring-inset',
        tone.avatar,
      )}
    >
      {initials(name)}
    </span>
  );
}

/** Spacer that keeps later bubbles in a group aligned with the first one (which carries the avatar). */
const AvatarSlot = () => <span aria-hidden="true" className="size-8 shrink-0" />;

type RowProps = {
  message: ThreadMessage;
  name: string;
  mine: boolean;
  first: boolean;
  /** Entry animation: only for messages that arrive live, never for a thread opened already revealed. */
  enter: boolean;
  reduced: boolean;
};

export function MessageRow({ message, name, mine, first, enter, reduced }: RowProps) {
  const bubble = clsx(
    'min-w-0 max-w-[82%] rounded-lg border px-3 py-1.5 shadow-hairline',
    mine
      ? clsx('border-flood-500/30 bg-flood-500/15', first && 'rounded-tr-xs')
      : clsx('border-night-600 bg-night-800', first && 'rounded-tl-xs'),
  );
  return (
    <motion.li
      data-testid="thread-msg"
      data-from={message.from}
      className={clsx(
        ROW_RESET,
        'msg',
        mine && 'me justify-end',
        first ? 'mt-3 first:mt-0' : 'mt-0.5',
      )}
      initial={enter ? { opacity: 0, y: reduced ? 0 : 10, scale: reduced ? 1 : 0.97 } : false}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ duration: reduced ? 0.12 : 0.28, ease: [0.16, 1, 0.3, 1] }}
      style={{ transformOrigin: mine ? 'right bottom' : 'left bottom' }}
    >
      {!mine && (first ? <Avatar slug={message.from} name={name} /> : <AvatarSlot />)}
      <div className={bubble}>
        {!mine && first && (
          <span
            aria-hidden="true"
            className={clsx('mb-0.5 block text-xs font-semibold', avatarTone(message.from).name)}
          >
            {name}
          </span>
        )}
        {/* One readable sentence per message for screen readers; the visible name and time repeat it. */}
        <span className="sr-only">
          {name} at {message.time}:{' '}
        </span>
        <span className="flow-root whitespace-pre-wrap break-words text-md text-chalk">
          {message.text}
          <time
            aria-hidden="true"
            className="float-right ml-3 mt-1.5 inline-flex items-center gap-1 text-xs text-chalk-dim tabular"
          >
            {message.time}
            {mine && <CheckCheck className="size-3.5 text-sky" strokeWidth={2.25} />}
          </time>
        </span>
      </div>
    </motion.li>
  );
}

/** The three dots, in the same place the next bubble will land. Decorative: the header carries the words. */
export function TypingBubble({
  slug,
  name,
  mine,
  tight,
  reduced,
}: {
  slug: string;
  name: string;
  mine: boolean;
  /** Same sender as the bubble above: sit close to it. */
  tight: boolean;
  reduced: boolean;
}) {
  return (
    <motion.div
      aria-hidden="true"
      data-testid="thread-typing"
      className={clsx('flex gap-2', tight ? 'mt-0.5' : 'mt-3', mine && 'justify-end')}
      initial={{ opacity: 0, y: reduced ? 0 : 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.16, ease: [0.16, 1, 0.3, 1] }}
    >
      {!mine && (tight ? <span className="size-8 shrink-0" /> : <Avatar slug={slug} name={name} />)}
      <div
        className={clsx(
          'flex h-8 items-center gap-1 rounded-lg border px-3.5',
          mine
            ? 'rounded-tr-xs border-flood-500/30 bg-flood-500/15'
            : 'rounded-tl-xs border-night-600 bg-night-800',
        )}
      >
        {['', '[animation-delay:0.18s]', '[animation-delay:0.36s]'].map((delay) => (
          <span
            key={delay}
            className={clsx('ds-still size-1.5 animate-typing rounded-full bg-chalk-dim', delay)}
          />
        ))}
      </div>
    </motion.div>
  );
}

/** Night wallpaper with floodlight glow (accent at 9%, the brief allows 6 to 10), like a chat background. */
export const WALLPAPER =
  'bg-night-900 bg-[radial-gradient(120%_70%_at_50%_-10%,color-mix(in_oklab,var(--color-flood-500)_9%,transparent),transparent_62%),radial-gradient(80%_50%_at_100%_100%,color-mix(in_oklab,var(--color-sky)_5%,transparent),transparent_70%)]';

export const SCROLL_AREA =
  'overflow-y-auto overscroll-contain [scrollbar-width:thin] [scrollbar-color:var(--color-night-600)_transparent]';
