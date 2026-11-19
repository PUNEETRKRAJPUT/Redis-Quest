'use client';
// The third-umpire review on the stadium screen: "Decision pending" while the engine checks, then the decision.
// It never takes pointer events and is hidden from assistive tech (the scoreboard carries the real verdict, with
// role="status"); a key press or click anywhere sends it away early.
import { clsx } from 'clsx';
import { AnimatePresence, motion } from 'motion/react';
import { useEffect, useState } from 'react';
import { EASE_OUT, SPRING } from '../design';
import type { Verdict } from '../types';
import styles from './BigScreen.module.css';
import { BIG_SCREEN, type Phase } from './decision';

/** After this long, "Decision pending" docks into a strip so the work stays visible. */
export const DOCK_AFTER_MS = 2200;

const GLOW = {
  turf: styles.glowTurf,
  flood: styles.glowFlood,
  wicket: styles.glowWicket,
  sky: styles.glowSky,
};
const TEXT = { turf: 'text-turf', flood: 'text-flood-400', wicket: 'text-wicket', sky: 'text-sky' };
const EDGE = {
  turf: 'border-turf/60 shadow-[0_0_80px_-10px_rgb(46_226_129/0.55)]',
  flood: 'border-flood-500/70 shadow-[0_0_80px_-10px_rgb(255_154_31/0.55)]',
  wicket: 'border-wicket/60 shadow-[0_0_80px_-10px_rgb(255_84_104/0.5)]',
  sky: 'border-sky/50',
};

export function BigScreen({
  phase,
  verdict,
  checks,
  xp,
  onDismiss,
}: {
  phase: Phase;
  verdict: Verdict | null;
  /** How many checks are running, for the line under "Decision pending". */
  checks: number;
  /** XP the pass earned, shown under a pass. */
  xp?: number;
  onDismiss: () => void;
}) {
  const show = phase === 'pending' || (phase === 'verdict' && verdict !== null);
  useEffect(() => {
    if (phase !== 'verdict') return;
    const away = () => onDismiss();
    window.addEventListener('keydown', away, true);
    window.addEventListener('pointerdown', away, true);
    return () => {
      window.removeEventListener('keydown', away, true);
      window.removeEventListener('pointerdown', away, true);
    };
  }, [phase, onDismiss]);

  // A long check (a load test runs for seconds) should not hide the work: after a moment the review docks into a
  // small strip at the top, and comes back full size for the decision.
  const [docked, setDocked] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    if (phase !== 'pending') return;
    const t0 = performance.now();
    const id = setInterval(() => {
      const ms = performance.now() - t0;
      setElapsed(Math.floor(ms / 1000));
      setDocked(ms >= DOCK_AFTER_MS);
    }, 250);
    return () => {
      clearInterval(id);
      setDocked(false);
      setElapsed(0);
    };
  }, [phase]);

  const look = verdict ? BIG_SCREEN[verdict] : null;
  const dock = docked && phase === 'pending';
  return (
    <AnimatePresence>
      {show ? (
        <motion.div
          key="big-screen"
          aria-hidden
          data-testid="big-screen"
          data-phase={phase}
          data-docked={dock ? 'true' : 'false'}
          className="pointer-events-none fixed inset-0 z-[60] grid place-items-center"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0, transition: { duration: 0.32, ease: EASE_OUT } }}
          transition={{ duration: 0.18, ease: EASE_OUT }}
        >
          <motion.div
            className="absolute inset-0 bg-[radial-gradient(70%_60%_at_50%_45%,rgb(7_10_18/0.55),rgb(7_10_18/0.86))]"
            animate={{ opacity: dock ? 0 : 1 }}
            transition={{ duration: 0.35, ease: EASE_OUT }}
          />
          <AnimatePresence mode="wait" initial={false}>
            {dock ? (
              <motion.div
                key="dock"
                className={clsx(
                  styles.face,
                  'absolute bottom-6 left-1/2 flex -translate-x-1/2 items-center gap-4 overflow-hidden rounded-full border border-flood-500/60 py-2 pl-5 pr-3 shadow-glow',
                )}
                initial={{ opacity: 0, y: 12, scale: 0.9 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: -8, transition: { duration: 0.12 } }}
                transition={SPRING.card}
              >
                <span
                  className={clsx(
                    styles.flicker,
                    styles.glowFlood,
                    'ds-still font-display text-xl font-bold uppercase tracking-[0.05em] text-flood-400',
                  )}
                >
                  Decision pending
                </span>
                <span className="text-sm text-chalk-dim">
                  {checks} check{checks === 1 ? '' : 's'} running
                </span>
                <span className="tabular font-mono text-sm text-chalk">
                  0:{String(elapsed).padStart(2, '0')}
                </span>
                <span className="h-2 w-20 overflow-hidden rounded-full border border-flood-500/40">
                  <span className={clsx(styles.stripes, 'ds-still block h-full w-full')} />
                </span>
              </motion.div>
            ) : (
              <motion.div
                key="face"
                className={clsx(
                  styles.face,
                  'relative w-[min(680px,88vw)] overflow-hidden rounded-xl border-2 px-10 pb-9 pt-7 text-center',
                  phase === 'verdict' && look ? EDGE[look.tone] : 'border-flood-500/45 shadow-pop',
                )}
                initial={{ scale: 0.94, y: 12, opacity: 0 }}
                animate={{ scale: 1, y: 0, opacity: 1 }}
                exit={{ scale: 0.97, y: -8, opacity: 0 }}
                transition={SPRING.card}
              >
                {phase === 'pending' ? <span className={styles.scan} /> : null}
                <div className="relative flex items-center justify-center gap-3">
                  <span className="h-px w-10 bg-chalk-faint/50" />
                  <span className="label-caps text-xs text-chalk-dim">Third umpire review</span>
                  <span className="h-px w-10 bg-chalk-faint/50" />
                </div>
                <AnimatePresence mode="wait" initial={false}>
                  {phase === 'pending' || !look ? (
                    <motion.div
                      key="pending"
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      exit={{ opacity: 0, scale: 1.04, transition: { duration: 0.12 } }}
                    >
                      <div
                        className={clsx(
                          styles.flicker,
                          styles.glowFlood,
                          'ds-still mt-4 font-display text-[64px] font-bold uppercase leading-[0.95] tracking-[0.03em] text-flood-400',
                        )}
                      >
                        Decision
                        <br />
                        pending
                      </div>
                      <div className="mx-auto mt-6 h-2.5 w-64 overflow-hidden rounded-full border border-flood-500/40">
                        <div className={clsx(styles.stripes, 'ds-still h-full w-full')} />
                      </div>
                      <p className="mb-0 mt-4 text-md text-chalk-dim">
                        Running {checks} check{checks === 1 ? '' : 's'} against your work
                      </p>
                    </motion.div>
                  ) : (
                    <motion.div
                      key="verdict"
                      initial={{ opacity: 0, scale: 1.25 }}
                      animate={{ opacity: 1, scale: 1 }}
                      transition={SPRING.pop}
                    >
                      <div
                        className={clsx(
                          GLOW[look.tone],
                          TEXT[look.tone],
                          'mt-4 font-display text-[88px] font-bold uppercase leading-none tracking-[0.02em]',
                        )}
                      >
                        {look.word}
                      </div>
                      <p className="mb-0 mt-4 font-display text-xl font-semibold uppercase tracking-[0.06em] text-chalk">
                        {look.flavour}
                      </p>
                      {verdict === 'right' && xp ? (
                        <motion.p
                          className="mb-0 mt-3 font-display text-2xl font-bold text-flood-400 tabular"
                          initial={{ opacity: 0, y: 10 }}
                          animate={{ opacity: 1, y: 0 }}
                          transition={{ delay: 0.25, duration: 0.3, ease: EASE_OUT }}
                        >
                          +{xp} XP
                        </motion.p>
                      ) : null}
                    </motion.div>
                  )}
                </AnimatePresence>
              </motion.div>
            )}
          </AnimatePresence>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}
