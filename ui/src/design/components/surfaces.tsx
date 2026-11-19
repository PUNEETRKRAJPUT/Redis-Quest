'use client';
// Surfaces: Card, Panel, Pill, Skeleton, EmptyState, Dialog.
import { clsx } from 'clsx';
import { X } from 'lucide-react';
import { useEffect, useId, useRef, type HTMLAttributes, type ReactNode } from 'react';
import { IconButton } from './controls';

export type CardProps = HTMLAttributes<HTMLDivElement> & {
  /** `base` sits on the page, `raised` is a step up, `inset` is a well (terminal, code, lists). */
  tone?: 'base' | 'raised' | 'inset';
  /** Hover lift and a brighter edge: for cards that are themselves links or buttons. */
  interactive?: boolean;
  /** The screen's one loud thing: an amber edge and a soft floodlight from above. Use once per screen. */
  focal?: boolean;
  padding?: 'none' | 'sm' | 'md' | 'lg';
};

const PAD = { none: '', sm: 'p-3', md: 'p-5', lg: 'p-7' } as const;
const TONE = {
  base: 'bg-night-900 border-night-600/80 shadow-raise',
  raised: 'bg-night-800 border-night-600 shadow-raise',
  inset: 'bg-night-950/80 border-night-600/60 shadow-[inset_0_1px_3px_rgb(0_0_0/0.5)]',
} as const;

export function Card({
  tone = 'base',
  interactive,
  focal,
  padding = 'md',
  className,
  children,
  ...rest
}: CardProps) {
  return (
    <div
      data-ds=""
      className={clsx(
        'relative rounded-lg border',
        TONE[tone],
        PAD[padding],
        interactive &&
          'cursor-pointer transition-[border-color,background-color,box-shadow,transform] duration-base ease-out-expo hover:border-chalk-faint/50 hover:bg-night-800 hover:shadow-pop motion-ok:hover:-translate-y-0.5',
        focal &&
          'border-flood-500/45 bg-[radial-gradient(120%_70%_at_50%_-10%,rgb(255_154_31/0.10),transparent_60%)] shadow-[inset_0_1px_0_rgb(255_179_71/0.18),0_0_0_1px_rgb(255_154_31/0.08),0_24px_60px_-28px_rgb(255_154_31/0.45)]',
        className,
      )}
      {...rest}
    >
      {children}
    </div>
  );
}

export type PanelProps = Omit<CardProps, 'title' | 'padding'> & {
  title: ReactNode;
  /** Small line above the title, e.g. "Over 3". */
  eyebrow?: ReactNode;
  /** Icon before the title. */
  icon?: ReactNode;
  /** Header slot on the right: buttons, a pill, a meter. */
  actions?: ReactNode;
  footer?: ReactNode;
  /** Heading level for the title; pick what fits the page outline. */
  as?: 'h2' | 'h3' | 'h4';
  bodyClassName?: string;
};

export function Panel({
  title,
  eyebrow,
  icon,
  actions,
  footer,
  as: H = 'h3',
  bodyClassName,
  children,
  className,
  ...rest
}: PanelProps) {
  return (
    <Card padding="none" className={clsx('flex flex-col overflow-hidden', className)} {...rest}>
      <header className="flex min-h-12 items-center gap-3 border-b border-night-600/70 px-4 py-2.5">
        {icon && (
          <span className="grid size-7 place-items-center rounded-sm bg-night-800 text-flood-400 shadow-hairline">
            {icon}
          </span>
        )}
        <div className="min-w-0 flex-1">
          {eyebrow && (
            <div className="label-caps text-[11px] leading-4 text-chalk-dim">{eyebrow}</div>
          )}
          <H className="label-caps truncate text-md leading-5 text-chalk">{title}</H>
        </div>
        {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
      </header>
      <div className={clsx('flex-1 p-4', bodyClassName)}>{children}</div>
      {footer && (
        <footer className="border-t border-night-600/70 bg-night-950/30 px-4 py-3">{footer}</footer>
      )}
    </Card>
  );
}

export type PillTone = 'neutral' | 'flood' | 'turf' | 'wicket' | 'sky' | 'cap';

const PILL_TONE: Record<PillTone, { box: string; dot: string }> = {
  neutral: { box: 'border-night-600 bg-night-800 text-chalk-dim', dot: 'bg-chalk-faint' },
  flood: {
    box: 'border-flood-500/40 bg-flood-500/10 text-flood-400',
    dot: 'bg-flood-500 shadow-[0_0_8px_rgb(255_154_31/0.9)]',
  },
  turf: {
    box: 'border-turf/35 bg-turf/10 text-turf',
    dot: 'bg-turf shadow-[0_0_8px_rgb(46_226_129/0.9)]',
  },
  wicket: {
    box: 'border-wicket/40 bg-wicket/10 text-wicket',
    dot: 'bg-wicket shadow-[0_0_8px_rgb(255_84_104/0.9)]',
  },
  sky: {
    box: 'border-sky/35 bg-sky/10 text-sky',
    dot: 'bg-sky shadow-[0_0_8px_rgb(92_200_255/0.9)]',
  },
  cap: {
    box: 'border-cap-purple/40 bg-cap-purple/10 text-cap-purple',
    dot: 'bg-cap-purple shadow-[0_0_8px_rgb(181_140_255/0.9)]',
  },
};

export type PillProps = HTMLAttributes<HTMLSpanElement> & {
  tone?: PillTone;
  /** `status` draws a light and caps the text; `tag` is a plain label. */
  variant?: 'status' | 'tag';
  /** Pulse the status light (something is live right now). */
  live?: boolean;
  icon?: ReactNode;
  size?: 'sm' | 'md';
};

export function Pill({
  tone = 'neutral',
  variant = 'tag',
  live,
  icon,
  size = 'md',
  className,
  children,
  ...rest
}: PillProps) {
  const t = PILL_TONE[tone];
  return (
    <span
      data-ds=""
      className={clsx(
        'inline-flex shrink-0 items-center whitespace-nowrap border',
        size === 'sm' ? 'h-5 gap-1 px-1.5' : 'h-6 gap-1.5 px-2',
        variant === 'status'
          ? clsx(
              'rounded-full font-display font-semibold uppercase tracking-[0.1em]',
              size === 'sm' ? 'text-[11px]' : 'text-xs',
            )
          : clsx('rounded-xs font-medium', size === 'sm' ? 'text-[11px]' : 'text-xs'),
        t.box,
        className,
      )}
      {...rest}
    >
      {variant === 'status' && !icon && (
        <span
          aria-hidden
          className={clsx('ds-still size-1.5 rounded-full', t.dot, live && 'animate-live')}
        />
      )}
      {icon}
      {children}
    </span>
  );
}

export type SkeletonProps = { className?: string; lines?: number; label?: string };

/** A loading placeholder. `lines` draws a paragraph; otherwise size it with className. */
export function Skeleton({ className, lines, label = 'Loading' }: SkeletonProps) {
  const bar =
    'ds-still block bg-night-800 bg-[linear-gradient(90deg,transparent_0%,rgb(255_255_255/0.05)_50%,transparent_100%)] bg-[length:200%_100%] bg-no-repeat animate-shimmer';
  if (lines) {
    return (
      <span
        data-ds=""
        role="status"
        aria-label={label}
        className={clsx('flex flex-col gap-2', className)}
      >
        {Array.from({ length: lines }, (_, i) => (
          <span
            key={i}
            className={clsx(bar, 'h-3.5 rounded-sm')}
            style={{ width: i === lines - 1 ? '62%' : `${96 - i * 3}%` }}
          />
        ))}
      </span>
    );
  }
  // Without a className it is one text line; with one, the caller sizes it (no defaults to fight).
  return (
    <span
      data-ds=""
      role="status"
      aria-label={label}
      className={clsx(
        bar,
        className ?? 'h-4 w-full',
        !className?.includes('rounded') && 'rounded-sm',
      )}
    />
  );
}

export type EmptyStateProps = {
  icon?: ReactNode;
  title: ReactNode;
  children?: ReactNode;
  action?: ReactNode;
  className?: string;
};

export function EmptyState({ icon, title, children, action, className }: EmptyStateProps) {
  return (
    <div
      data-ds=""
      className={clsx('flex flex-col items-center px-6 py-10 text-center', className)}
    >
      {icon && (
        <div className="relative mb-4 grid size-14 place-items-center rounded-full border border-night-600 bg-night-800 text-chalk-dim shadow-raise">
          <span
            aria-hidden
            className="absolute -inset-3 rounded-full border border-dashed border-night-600/70"
          />
          {icon}
        </div>
      )}
      <h3 className="font-display text-xl font-semibold uppercase tracking-[0.04em] text-chalk">
        {title}
      </h3>
      {children && (
        <p className="mt-1.5 max-w-sm text-md leading-relaxed text-chalk-dim">{children}</p>
      )}
      {action && <div className="mt-5 flex gap-2">{action}</div>}
    </div>
  );
}

export type DialogProps = {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  description?: ReactNode;
  children?: ReactNode;
  /** Buttons, right-aligned. */
  footer?: ReactNode;
  size?: 'sm' | 'md' | 'lg';
  /** `danger` tints the edge for destructive confirmations. */
  tone?: 'default' | 'danger';
  className?: string;
};

const DIALOG_W = {
  sm: 'w-[min(92vw,400px)]',
  md: 'w-[min(92vw,520px)]',
  lg: 'w-[min(94vw,720px)]',
} as const;

/**
 * A modal on the native <dialog>: the browser traps focus, makes the page inert, closes on Escape and returns focus
 * to the trigger. Controlled: Escape and a backdrop click call `onClose`.
 */
export function Dialog({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  size = 'md',
  tone = 'default',
  className,
}: DialogProps) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const descId = useId();
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);
  return (
    <dialog
      ref={ref}
      data-ds=""
      aria-labelledby={titleId}
      aria-describedby={description ? descId : undefined}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      className={clsx(
        'ds-dialog m-auto max-h-[85vh] overflow-visible rounded-xl border bg-night-900 p-0 text-chalk shadow-pop',
        tone === 'danger' ? 'border-wicket/45' : 'border-night-600',
        DIALOG_W[size],
        className,
      )}
    >
      <div className="relative flex max-h-[85vh] flex-col overflow-hidden rounded-xl">
        <span
          aria-hidden
          className={clsx(
            'pointer-events-none absolute inset-x-0 top-0 h-24',
            tone === 'danger'
              ? 'bg-[radial-gradient(60%_100%_at_50%_0%,rgb(255_84_104/0.12),transparent)]'
              : 'bg-[radial-gradient(60%_100%_at_50%_0%,rgb(255_154_31/0.10),transparent)]',
          )}
        />
        <div className="relative flex items-start gap-4 px-6 pt-5">
          <div className="min-w-0 flex-1">
            <h2
              id={titleId}
              className="font-display text-2xl font-semibold uppercase leading-tight tracking-[0.02em] text-chalk"
            >
              {title}
            </h2>
            {description && (
              <p id={descId} className="mt-1 text-md leading-relaxed text-chalk-dim">
                {description}
              </p>
            )}
          </div>
          <IconButton
            label="Close"
            icon={<X size={16} />}
            variant="quiet"
            size="sm"
            tooltip={false}
            onClick={onClose}
            className="-mr-2"
          />
        </div>
        {children && (
          <div className="relative overflow-auto px-6 py-4 text-base leading-relaxed text-chalk-dim">
            {children}
          </div>
        )}
        {footer && (
          <div className="relative mt-2 flex justify-end gap-2 border-t border-night-600/70 bg-night-950/40 px-6 py-4">
            {footer}
          </div>
        )}
      </div>
    </dialog>
  );
}
