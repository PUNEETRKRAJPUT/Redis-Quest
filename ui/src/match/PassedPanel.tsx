'use client';
// The pass, kept on the scoreboard: the XP the level paid (counted up when it was just earned), the badge as a cap,
// "rebuilt in" for an interview, and one obvious next action. The show-me panels sit under it.
import { clsx } from 'clsx';
import { ArrowRight, Award, Check, MapIcon } from 'lucide-react';
import { useEffect, useState, type ReactNode, type Ref } from 'react';
import { useReducedMotion } from '../design';
import { QuestLink } from '../shell/QuestLink';

/** Counts from 0 to `to` over `ms` once `run` turns true; shows `to` at once otherwise or under reduced motion. */
export function useCountUp(to: number, run: boolean, ms = 900): number {
  const reduced = useReducedMotion();
  const [n, setN] = useState(run && !reduced ? 0 : to);
  useEffect(() => {
    if (!run || reduced) {
      setN(to);
      return;
    }
    let raf = 0;
    const t0 = performance.now();
    const step = (t: number) => {
      const p = Math.min(1, (t - t0) / ms);
      setN(Math.round(to * (1 - Math.pow(1 - p, 3))));
      if (p < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [to, run, reduced, ms]);
  return n;
}

/** A badge as an enamel cap: a ringed purple disc with a struck emblem. */
export function Cap({ name, size = 56 }: { name: string; size?: number }) {
  return (
    <span
      aria-hidden
      className="relative grid shrink-0 place-items-center rounded-full"
      style={{
        width: size,
        height: size,
        background:
          'radial-gradient(circle at 35% 30%, rgb(255 255 255 / 0.35), transparent 38%), radial-gradient(circle at 50% 60%, #8a5cf0, #4b2a99 72%)',
        boxShadow:
          'inset 0 0 0 3px rgb(181 140 255 / 0.9), inset 0 0 0 6px rgb(28 16 64 / 0.9), 0 6px 20px -6px rgb(181 140 255 / 0.8)',
      }}
      title={name}
    >
      <Award size={size * 0.42} strokeWidth={2.2} className="text-chalk drop-shadow" />
    </span>
  );
}

export function PassedPanel({
  xp,
  badge,
  rebuilt,
  justPassed,
  next,
  nextRef,
  showMe,
}: {
  xp: number;
  badge?: string;
  /** "rebuilt in m:ss" (interview levels), already capitalised. */
  rebuilt: string | null;
  /** The pass happened on this screen just now: count the XP up. */
  justPassed: boolean;
  next: { id: string; title: string } | null;
  nextRef: Ref<HTMLAnchorElement>;
  showMe: ReactNode;
}) {
  const shown = useCountUp(xp, justPassed);
  return (
    <div
      className={clsx(
        'relative overflow-hidden rounded-lg border border-turf/40 p-4',
        'bg-[radial-gradient(130%_80%_at_50%_-20%,rgb(46_226_129/0.18),transparent_65%)] shadow-glow-turf',
      )}
      data-testid="passed-panel"
    >
      <div className="flex items-center gap-4">
        <div className="min-w-0 flex-1">
          <p className="m-0 flex items-center gap-2 font-display text-lg font-bold uppercase tracking-[0.06em] text-turf">
            <Check size={18} strokeWidth={3} aria-hidden /> Level passed
          </p>
          <p className="m-0 mt-1 flex items-baseline gap-2">
            <span className="tabular font-display text-[44px] font-bold leading-none text-flood-400 [text-shadow:0_0_24px_rgb(255_154_31/0.45)]">
              +{shown}
            </span>
            <span className="label-caps text-md text-chalk-dim">XP</span>
            <span className="sr-only">{`Earned ${xp} XP`}</span>
          </p>
        </div>
        {badge ? (
          <div className="flex max-w-[45%] flex-col items-center gap-1.5 text-center">
            <Cap name={badge} />
            <span className="text-xs font-semibold leading-tight text-cap-purple">
              <span className="sr-only">Badge earned: </span>
              {badge}
            </span>
          </div>
        ) : null}
      </div>
      {rebuilt ? (
        <p
          className="mb-0 mt-3 font-display text-lg font-semibold uppercase tracking-[0.04em] text-chalk"
          data-testid="rebuilt-in"
        >
          {rebuilt}
        </p>
      ) : null}
      <div className="mt-4">
        {next ? (
          <QuestLink
            ref={nextRef}
            to={{ name: 'level', id: next.id }}
            data-testid="next-level"
            className={clsx(
              'group flex min-h-14 w-full items-center justify-between gap-3 rounded-md bg-flood-500 px-4 py-2 text-on-flood',
              'shadow-[inset_0_1px_0_rgb(255_255_255/0.38),0_10px_28px_-10px_rgb(255_154_31/0.7)]',
              'transition-[background-color,transform] duration-fast hover:bg-flood-400 motion-ok:active:translate-y-px',
            )}
          >
            <span className="flex min-w-0 flex-col text-left leading-tight">
              <span className="label-caps text-[11px] text-on-flood/75">Next level</span>
              <span className="truncate text-base font-semibold">
                <span className="sr-only">Next level: </span>
                {next.title}
              </span>
            </span>
            <ArrowRight
              size={18}
              aria-hidden
              className="shrink-0 transition-transform duration-fast motion-ok:group-hover:translate-x-0.5"
            />
          </QuestLink>
        ) : (
          <QuestLink
            ref={nextRef}
            to="/"
            className="flex h-11 w-full items-center justify-center gap-2 rounded-md border border-night-600 bg-night-900 text-md font-semibold text-chalk transition-colors duration-fast hover:bg-night-800"
          >
            <MapIcon size={16} aria-hidden /> Back to the map
          </QuestLink>
        )}
      </div>
      {showMe ? <div className="mt-4 border-t border-turf/20 pt-4">{showMe}</div> : null}
    </div>
  );
}
