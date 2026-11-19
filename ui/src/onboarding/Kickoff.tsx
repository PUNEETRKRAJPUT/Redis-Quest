'use client';
// The kick-off beat: "Welcome to the league, <name>" for two seconds over the game that is already loading behind
// it. The store flips to `ready` the moment the player exists, which unmounts the Welcome screen, so the beat
// lives in its own React root on document.body and outlives it. It never takes pointer events (clicks reach the
// game underneath); any key or a click on it skips it.
import { AnimatePresence, motion } from 'motion/react';
import { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { DURATION, EASE_OUT, celebrate, useReducedMotion } from '../design';
import { Jersey } from './Jersey';
import { jerseyColor, type JerseyId } from './profile';

export const KICKOFF_MS = 2000;

function Beat({ name, jersey, onDone }: { name: string; jersey: JerseyId; onDone: () => void }) {
  const reduced = useReducedMotion();
  const [open, setOpen] = useState(true);

  useEffect(() => {
    celebrate({ confetti: { count: 90, y: 0.35 } });
    const id = setTimeout(() => setOpen(false), reduced ? 1200 : KICKOFF_MS);
    const skip = () => setOpen(false);
    window.addEventListener('keydown', skip);
    return () => {
      clearTimeout(id);
      window.removeEventListener('keydown', skip);
    };
  }, [reduced]);

  return (
    <AnimatePresence onExitComplete={onDone}>
      {open ? (
        <motion.div
          key="kickoff"
          data-ds=""
          data-testid="welcome-kickoff"
          role="status"
          aria-live="polite"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0, transition: { duration: DURATION.slow, ease: EASE_OUT } }}
          transition={{ duration: DURATION.fast }}
          className="pointer-events-none fixed inset-0 z-[70] grid place-items-center bg-night-950/92 backdrop-blur-sm"
          style={{
            background:
              'radial-gradient(60% 50% at 50% 38%, rgb(255 179 71 / 0.14), transparent 70%), rgb(7 10 18 / 0.93)',
          }}
        >
          <div className="flex flex-col items-center gap-5 text-center">
            <motion.div
              initial={reduced ? false : { opacity: 0, y: 24, rotate: -4, scale: 0.9 }}
              animate={{ opacity: 1, y: 0, rotate: 0, scale: 1 }}
              transition={{ type: 'spring', stiffness: 260, damping: 20, delay: 0.1 }}
            >
              <Jersey
                color={jerseyColor(jersey)}
                name={name}
                className="h-[144px] w-[132px] drop-shadow-[0_14px_30px_rgb(0_0_0/0.6)]"
              />
            </motion.div>
            <motion.p
              initial={reduced ? false : { opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: DURATION.slow, ease: EASE_OUT, delay: 0.25 }}
              className="label-caps m-0 text-lg tracking-[0.28em] text-flood-400"
            >
              Welcome to the league
            </motion.p>
            <motion.h2
              initial={reduced ? false : { opacity: 0, y: 18 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: DURATION.slow, ease: EASE_OUT, delay: 0.4 }}
              className="m-0 max-w-[80vw] truncate font-display text-[clamp(48px,8vw,96px)] font-bold uppercase leading-none tracking-[0.03em] text-chalk"
            >
              {name}
            </motion.h2>
            <p className="m-0 text-md text-chalk-dim">Chapter 0 is warming up.</p>
          </div>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}

/** Mounts the beat on document.body; it removes itself when it has faded out. Safe to call once per sign-up. */
export function showKickoff(opts: { name: string; jersey: JerseyId }): void {
  if (typeof document === 'undefined') return;
  const host = document.createElement('div');
  host.setAttribute('data-kickoff-host', '');
  document.body.appendChild(host);
  const root = createRoot(host);
  const done = () => {
    // Unmount after the exit animation has finished, outside React's current render.
    setTimeout(() => {
      root.unmount();
      host.remove();
    }, 0);
  };
  root.render(<Beat name={opts.name} jersey={opts.jersey} onDone={done} />);
}
