'use client';

// The "rain delay" strip under the HUD: calm, plain words, the exact command that fixes it, and a short
// "Play resumes" when the stack is back. Navigation keeps working underneath it.

import { clsx } from 'clsx';
import { AnimatePresence, motion } from 'motion/react';
import { CircleCheck, CloudRain } from 'lucide-react';
import { useOffline } from 'next/offline';
import { useEffect, useRef, useState } from 'react';
import { DURATION, EASE_OUT, useReducedMotion } from '@/design/motion';
import { play } from '@/design/sound';
import { useQuest } from '../store';
import { CommandChip } from './CommandChip';
import {
  RAIN_SHOW_DELAY_MS,
  REDIS_COMMAND,
  RESUME_MS,
  STACK_COMMAND,
  rainReason,
  type RainReason,
} from './rain';

type View = { kind: 'rain'; reason: Exclude<RainReason, null> } | { kind: 'resumed' } | null;

/**
 * What the strip shows. A problem must last a moment before it shows (the socket needs a beat on every page
 * load); once shown it stays until the stack answers, then "Play resumes" for a few seconds.
 */
export function useRainView(): View {
  const boot = useQuest((s) => s.boot);
  const ws = useQuest((s) => s.wsState);
  const redisUp = useQuest((s) => s.redisUp);
  const offline = useOffline();
  const reason = rainReason({ boot, ws, redisUp, offline });
  const [shown, setShown] = useState<RainReason>(null);
  const [resumed, setResumed] = useState(false);
  const wasShown = useRef(false);

  useEffect(() => {
    if (reason) {
      setResumed(false);
      // Already showing: switch wording at once. Otherwise wait out a blip.
      const t = setTimeout(
        () => {
          wasShown.current = true;
          setShown(reason);
        },
        wasShown.current ? 0 : RAIN_SHOW_DELAY_MS,
      );
      return () => clearTimeout(t);
    }
    setShown(null);
    if (wasShown.current) {
      wasShown.current = false;
      setResumed(true);
      play('tock');
    }
  }, [reason]);

  useEffect(() => {
    if (!resumed) return;
    const t = setTimeout(() => setResumed(false), RESUME_MS);
    return () => clearTimeout(t);
  }, [resumed]);

  if (reason && shown) return { kind: 'rain', reason };
  if (resumed && !reason) return { kind: 'resumed' };
  return null;
}

const COPY = {
  stack: {
    title: 'Rain delay',
    text: 'The game engine is not answering, so levels cannot be checked. Your files and progress are safe. Start the stack again:',
    command: STACK_COMMAND,
  },
  redis: {
    title: 'Rain delay',
    text: 'Redis is down. If a level asked you to stop it, carry on. Otherwise bring it back:',
    command: REDIS_COMMAND,
  },
} as const;

export function RainDelayStrip() {
  const view = useRainView();
  const reduced = useReducedMotion();
  const key = view ? (view.kind === 'rain' ? `rain-${view.reason}` : 'resumed') : null;
  return (
    <AnimatePresence initial={false} mode="wait">
      {view && key && (
        <motion.div
          key={key}
          data-ds=""
          role="status"
          data-testid={view.kind === 'rain' ? 'rain-delay' : 'play-resumes'}
          initial={{ opacity: 0, y: reduced ? 0 : -8 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, transition: { duration: DURATION.fast } }}
          transition={{ duration: reduced ? DURATION.fast : DURATION.base, ease: EASE_OUT }}
          className={clsx(
            'relative flex min-h-11 items-center gap-3 overflow-hidden border-b px-4 py-1.5',
            view.kind === 'rain'
              ? 'border-flood-500/30 bg-[linear-gradient(90deg,rgb(255_154_31/0.10),rgb(17_24_51/0.9)_45%,rgb(11_16_32/0.95))]'
              : 'border-turf/30 bg-[linear-gradient(90deg,rgb(46_226_129/0.12),rgb(11_16_32/0.95)_60%)]',
          )}
        >
          {view.kind === 'rain' ? (
            <>
              <span aria-hidden className="rq-rain ds-still" />
              <CloudRain size={18} aria-hidden className="relative shrink-0 text-flood-400" />
              <p className="relative min-w-0 flex-1 text-md leading-5 text-chalk-dim">
                <strong className="label-caps mr-2 text-base text-flood-400">
                  {COPY[view.reason].title}
                </strong>
                {COPY[view.reason].text}
              </p>
              <CommandChip command={COPY[view.reason].command} className="relative" />
            </>
          ) : (
            <>
              <CircleCheck size={18} aria-hidden className="shrink-0 text-turf" />
              <p className="min-w-0 flex-1 text-md leading-5 text-chalk-dim">
                <strong className="label-caps mr-2 text-base text-turf">Play resumes</strong>
                The stack is back and everything is connected.
              </p>
            </>
          )}
        </motion.div>
      )}
    </AnimatePresence>
  );
}
