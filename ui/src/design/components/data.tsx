'use client';
// Data on the scoreboard: ProgressBar, Meter, FlipNumber, Scoreline.
import { clsx } from 'clsx';
import { AnimatePresence, motion } from 'motion/react';
import { useEffect, useMemo, useRef, type ReactNode } from 'react';
import { diffDigits, toDigits } from '../digits';
import { DURATION, EASE_OUT, SPRING, useReducedMotion } from '../motion';
import { play } from '../sound';

type Tone = 'flood' | 'turf' | 'wicket' | 'sky' | 'cap';
const FILL: Record<Tone, string> = {
  flood:
    'bg-[linear-gradient(90deg,var(--color-flood-600),var(--color-flood-400))] shadow-[0_0_14px_rgb(255_154_31/0.45)]',
  turf: 'bg-[linear-gradient(90deg,#1fb866,var(--color-turf))] shadow-[0_0_14px_rgb(46_226_129/0.4)]',
  wicket:
    'bg-[linear-gradient(90deg,#d93a50,var(--color-wicket))] shadow-[0_0_14px_rgb(255_84_104/0.4)]',
  sky: 'bg-[linear-gradient(90deg,#2f9fdc,var(--color-sky))] shadow-[0_0_14px_rgb(92_200_255/0.4)]',
  cap: 'bg-[linear-gradient(90deg,#8c63e0,var(--color-cap-purple))] shadow-[0_0_14px_rgb(181_140_255/0.4)]',
};

export type ProgressBarProps = {
  /** 0..max. Leave out for an indeterminate bar. */
  value?: number;
  max?: number;
  label: ReactNode;
  /** Draw the label above the bar (true) or keep it for screen readers only. */
  showLabel?: boolean;
  /** Text at the right of the label row, e.g. "7 / 12". Defaults to a percentage. */
  valueText?: string;
  tone?: Tone;
  size?: 'sm' | 'md';
  className?: string;
};

export function ProgressBar({
  value,
  max = 100,
  label,
  showLabel = true,
  valueText,
  tone = 'flood',
  size = 'md',
  className,
}: ProgressBarProps) {
  const indeterminate = value === undefined;
  const frac = indeterminate ? 0 : Math.min(1, Math.max(0, value / max));
  const text = valueText ?? (indeterminate ? '' : `${Math.round(frac * 100)}%`);
  return (
    <div data-ds="" className={clsx('w-full', className)}>
      {showLabel && (
        <div className="mb-1.5 flex items-baseline justify-between gap-3 text-sm">
          <span className="font-medium text-chalk-dim">{label}</span>
          <span className="tabular font-mono text-xs text-chalk-dim">{text}</span>
        </div>
      )}
      <div
        role="progressbar"
        aria-label={typeof label === 'string' ? label : undefined}
        aria-valuemin={0}
        aria-valuemax={max}
        aria-valuenow={indeterminate ? undefined : value}
        aria-valuetext={text || undefined}
        className={clsx(
          'relative overflow-hidden rounded-full bg-night-800 shadow-[inset_0_1px_2px_rgb(0_0_0/0.5)]',
          size === 'sm' ? 'h-1.5' : 'h-2.5',
        )}
      >
        {indeterminate ? (
          <span
            className={clsx(
              'ds-still absolute inset-y-0 w-full rounded-full animate-shimmer bg-[length:40%_100%] bg-no-repeat',
              'bg-[linear-gradient(90deg,transparent,var(--color-flood-500),transparent)]',
            )}
          />
        ) : (
          <span
            className={clsx(
              'absolute inset-y-0 left-0 w-full origin-left rounded-full transition-transform duration-slow ease-out-expo',
              FILL[tone],
            )}
            style={{ transform: `scaleX(${frac})` }}
          />
        )}
      </div>
    </div>
  );
}

export type MeterProps = {
  value: number;
  min?: number;
  max?: number;
  label: ReactNode;
  /** Shown at the right of the label, e.g. "412 MB". */
  valueText?: string;
  /** Fractions of the range where the light turns amber and red. Default 0.7 and 0.9. */
  warnAt?: number;
  dangerAt?: number;
  /** Segments in the bar, like a stadium LED board. */
  segments?: number;
  className?: string;
};

/** A gauge for a level in a known range (memory, latency, hit rate): segmented, coloured by threshold. */
export function Meter({
  value,
  min = 0,
  max = 100,
  label,
  valueText,
  warnAt = 0.7,
  dangerAt = 0.9,
  segments = 24,
  className,
}: MeterProps) {
  const frac = Math.min(1, Math.max(0, (value - min) / (max - min || 1)));
  const lit = Math.round(frac * segments);
  const state = frac >= dangerAt ? 'danger' : frac >= warnAt ? 'warn' : 'ok';
  const segColour = (i: number) => {
    const f = (i + 1) / segments;
    if (f > dangerAt) return 'bg-wicket shadow-[0_0_6px_rgb(255_84_104/0.7)]';
    if (f > warnAt) return 'bg-flood-500 shadow-[0_0_6px_rgb(255_154_31/0.7)]';
    return 'bg-turf shadow-[0_0_6px_rgb(46_226_129/0.55)]';
  };
  return (
    <div data-ds="" className={clsx('w-full', className)}>
      <div className="mb-1.5 flex items-baseline justify-between gap-3 text-sm">
        <span className="font-medium text-chalk-dim">{label}</span>
        <span
          className={clsx(
            'tabular font-mono text-xs',
            state === 'danger' ? 'text-wicket' : state === 'warn' ? 'text-flood-400' : 'text-turf',
          )}
        >
          {valueText ?? value}
        </span>
      </div>
      <div
        role="meter"
        aria-label={typeof label === 'string' ? label : undefined}
        aria-valuemin={min}
        aria-valuemax={max}
        aria-valuenow={value}
        aria-valuetext={valueText}
        className="flex h-3 gap-[3px]"
      >
        {Array.from({ length: segments }, (_, i) => (
          <span
            key={i}
            className={clsx(
              'flex-1 rounded-[2px] transition-[background-color,box-shadow] duration-base',
              i < lit ? segColour(i) : 'bg-night-800',
            )}
          />
        ))}
      </div>
    </div>
  );
}

export type FlipSize = 'sm' | 'md' | 'lg' | 'xl';
const FLIP_TEXT: Record<FlipSize, string> = {
  sm: 'text-[20px]',
  md: 'text-[28px]',
  lg: 'text-[40px]',
  xl: 'text-[64px]',
};

export type FlipNumberProps = {
  value: number;
  /** Pads with leading zeros, scoreboard style. */
  minDigits?: number;
  size?: FlipSize;
  /** Plays `flip` per changed digit (silent while sound is off). */
  sound?: boolean;
  /** Accessible name prefix, e.g. "XP". The number is announced as text, the cells are hidden. */
  label?: string;
  /** Digit colour. */
  tone?: 'chalk' | 'flood' | 'turf';
  className?: string;
};

/** Scoreboard digits: each changed digit flips on its own card, units first, like a split-flap board. */
export function FlipNumber({
  value,
  minDigits = 1,
  size = 'md',
  sound = true,
  label,
  tone = 'chalk',
  className,
}: FlipNumberProps) {
  const reduced = useReducedMotion();
  const digits = useMemo(() => toDigits(value, minDigits), [value, minDigits]);
  const prev = useRef<string[]>(digits);
  const cells = diffDigits(prev.current, digits);
  // Units flip first, then tens, and so on: rank each changed cell from the right.
  const rank = new Map<string, number>();
  [...cells].reverse().forEach((c) => c.changed && rank.set(c.key, rank.size));

  useEffect(() => {
    const before = prev.current;
    prev.current = digits;
    if (!sound || before.join('') === digits.join('')) return;
    const n = Math.min(4, diffDigits(before, digits).filter((c) => c.changed).length);
    const timers = Array.from({ length: n }, (_, i) => setTimeout(() => play('flip'), i * 45));
    return () => timers.forEach(clearTimeout);
  }, [digits, sound]);

  return (
    <span
      data-ds=""
      className={clsx(
        'inline-flex items-center gap-[0.06em] font-display font-bold leading-none',
        FLIP_TEXT[size],
        className,
      )}
    >
      <span className="sr-only" aria-live="polite">
        {label ? `${label} ${value}` : value}
      </span>
      {cells.map((c) => {
        const delay = (rank.get(c.key) ?? 0) * 0.045;
        if (c.digit === '-') {
          return (
            <span key={c.key} aria-hidden className="px-[0.05em] text-chalk-dim">
              -
            </span>
          );
        }
        return (
          <span
            key={c.key}
            aria-hidden
            className="ds-flap relative inline-block h-[1.18em] w-[0.7em] overflow-hidden rounded-[0.12em] border border-night-600/80 bg-night-800 shadow-[inset_0_1px_0_rgb(255_255_255/0.06),0_2px_6px_rgb(0_0_0/0.5)]"
          >
            <span className="absolute inset-x-0 top-0 h-1/2 bg-[linear-gradient(180deg,rgb(255_255_255/0.05),rgb(255_255_255/0.015))]" />
            <AnimatePresence initial={false} mode="popLayout">
              <motion.span
                key={c.digit}
                className={clsx(
                  'ds-flap__card tabular absolute inset-0 grid place-items-center pt-[0.04em]',
                  tone === 'flood'
                    ? 'text-flood-400'
                    : tone === 'turf'
                      ? 'text-turf'
                      : 'text-chalk',
                )}
                initial={reduced ? { opacity: 0 } : { rotateX: -100, opacity: 0.4 }}
                animate={reduced ? { opacity: 1 } : { rotateX: 0, opacity: 1 }}
                exit={reduced ? { opacity: 0 } : { rotateX: 100, opacity: 0 }}
                transition={
                  reduced
                    ? { duration: DURATION.fast, ease: EASE_OUT }
                    : { ...SPRING.flip, delay, opacity: { duration: 0.12, delay } }
                }
              >
                {c.digit}
              </motion.span>
            </AnimatePresence>
            <span className="pointer-events-none absolute inset-x-0 top-1/2 h-px -translate-y-px bg-night-950/90 shadow-[0_1px_0_rgb(255_255_255/0.04)]" />
          </span>
        );
      })}
    </span>
  );
}

export type ScorelineProps = {
  label: ReactNode;
  value: number | string;
  /** Small text after the number: "XP", "ms", "/ 12". */
  unit?: ReactNode;
  /** Draw the number in flip digits (numbers only). */
  flip?: boolean;
  minDigits?: number;
  /** A change to show beside the number: +40 in turf, -3 in wicket. */
  delta?: number;
  size?: 'sm' | 'md' | 'lg';
  tone?: 'chalk' | 'flood' | 'turf';
  hint?: ReactNode;
  className?: string;
};

const SCORE_TEXT = { sm: 'text-2xl', md: 'text-3xl', lg: 'text-4xl' } as const;
const SCORE_FLIP: Record<'sm' | 'md' | 'lg', FlipSize> = { sm: 'sm', md: 'md', lg: 'lg' };

/** A label over a big tabular number: the unit of every scoreboard. */
export function Scoreline({
  label,
  value,
  unit,
  flip,
  minDigits,
  delta,
  size = 'md',
  tone = 'chalk',
  hint,
  className,
}: ScorelineProps) {
  const toneText =
    tone === 'flood' ? 'text-flood-400' : tone === 'turf' ? 'text-turf' : 'text-chalk';
  return (
    <div data-ds="" className={clsx('flex flex-col gap-1.5', className)}>
      <div className="label-caps text-xs text-chalk-dim">{label}</div>
      <div className="flex items-baseline gap-2">
        {flip && typeof value === 'number' ? (
          <FlipNumber
            value={value}
            minDigits={minDigits}
            size={SCORE_FLIP[size]}
            tone={tone}
            label={typeof label === 'string' ? label : undefined}
          />
        ) : (
          <span
            className={clsx(
              'tabular font-display font-bold leading-none',
              SCORE_TEXT[size],
              toneText,
            )}
          >
            {value}
          </span>
        )}
        {unit && <span className="label-caps text-sm text-chalk-dim">{unit}</span>}
        {delta !== undefined && delta !== 0 && (
          <span
            className={clsx(
              'tabular font-mono text-xs font-semibold',
              delta > 0 ? 'text-turf' : 'text-wicket',
            )}
          >
            {delta > 0 ? `+${delta}` : delta}
          </span>
        )}
      </div>
      {hint && <div className="text-sm text-chalk-dim">{hint}</div>}
    </div>
  );
}
