'use client';
// Controls: Button, IconButton, Tooltip, Kbd, Switch, Segmented, Tabs.
import { clsx } from 'clsx';
import { LoaderCircle } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import {
  cloneElement,
  isValidElement,
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type KeyboardEvent,
  type ReactElement,
  type ReactNode,
} from 'react';
import { DURATION, EASE_OUT, SPRING, useReducedMotion } from '../motion';
import { play } from '../sound';

export type ButtonVariant = 'primary' | 'ghost' | 'quiet' | 'danger';
export type ButtonSize = 'sm' | 'md' | 'lg';

const BASE =
  'group/btn relative inline-flex shrink-0 cursor-pointer select-none items-center justify-center whitespace-nowrap font-sans font-semibold tracking-[0.005em] ' +
  'transition-[background-color,border-color,color,box-shadow,transform,opacity] duration-fast ease-out-expo ' +
  'aria-busy:cursor-progress ' +
  'motion-ok:enabled:active:translate-y-px motion-ok:enabled:active:scale-[0.985]';

const VARIANT: Record<ButtonVariant, string> = {
  primary:
    'bg-flood-500 text-on-flood shadow-[inset_0_1px_0_rgb(255_255_255/0.38),inset_0_-1px_0_rgb(0_0_0/0.2),0_1px_2px_rgb(0_0_0/0.5)] ' +
    'enabled:hover:bg-flood-400 enabled:hover:shadow-[inset_0_1px_0_rgb(255_255_255/0.45),inset_0_-1px_0_rgb(0_0_0/0.2),0_10px_28px_-8px_rgb(255_154_31/0.6)] ' +
    'enabled:active:bg-flood-600 enabled:active:shadow-[inset_0_1px_2px_rgb(0_0_0/0.25)]',
  ghost:
    'border border-night-600 bg-night-900/70 text-chalk shadow-hairline ' +
    'enabled:hover:border-chalk-faint/70 enabled:hover:bg-night-800 enabled:active:bg-night-700',
  quiet:
    'text-chalk-dim enabled:hover:bg-night-800 enabled:hover:text-chalk enabled:active:bg-night-700',
  danger:
    'border border-wicket/45 bg-wicket/10 text-wicket ' +
    'enabled:hover:border-wicket/80 enabled:hover:bg-wicket/20 enabled:hover:shadow-glow-wicket enabled:active:bg-wicket/25',
};

// Disabled (and not loading) drops the light: flat, dim, no glow. Loading keeps the variant's colour.
const DISABLED: Record<ButtonVariant, string> = {
  primary: 'cursor-not-allowed bg-night-700 text-chalk-faint shadow-none',
  ghost: 'cursor-not-allowed border-night-600/60 bg-transparent text-chalk-faint shadow-none',
  quiet: 'cursor-not-allowed text-chalk-faint',
  danger: 'cursor-not-allowed border-wicket/20 bg-transparent text-wicket/45',
};

const SIZE: Record<ButtonSize, string> = {
  sm: 'h-8 gap-1.5 rounded-sm px-3 text-sm',
  md: 'h-10 gap-2 rounded-md px-4 text-md',
  lg: 'h-12 gap-2.5 rounded-md px-6 text-base',
};
const ICON_SIZE: Record<ButtonSize, number> = { sm: 14, md: 16, lg: 18 };

export type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** Shows a spinner, disables the button and sets aria-busy. The label keeps its width. */
  loading?: boolean;
  /** Replaces the label while loading, e.g. "Decision pending". */
  loadingText?: string;
  /** An icon before the label (lucide element). */
  leading?: ReactNode;
  /** An icon after the label. */
  trailing?: ReactNode;
  /** A keyboard hint drawn at the right edge, e.g. "⌘↵". */
  shortcut?: string;
};

export function Button({
  variant = 'primary',
  size = 'md',
  loading = false,
  loadingText,
  leading,
  trailing,
  shortcut,
  className,
  children,
  disabled,
  type = 'button',
  ...rest
}: ButtonProps) {
  const spinner = (
    <LoaderCircle size={ICON_SIZE[size]} className="ds-spin animate-spin" aria-hidden />
  );
  return (
    <button
      data-ds=""
      type={type}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={clsx(
        BASE,
        disabled && !loading ? DISABLED[variant] : VARIANT[variant],
        SIZE[size],
        className,
      )}
      {...rest}
    >
      {loading && loadingText ? (
        <>
          {spinner}
          <span>{loadingText}</span>
        </>
      ) : (
        <>
          <span className={clsx('inline-flex items-center gap-[inherit]', loading && 'opacity-0')}>
            {leading}
            {children}
            {trailing}
            {shortcut && (
              <kbd
                className={clsx(
                  'ml-1 font-mono text-[11px] font-medium leading-none',
                  variant === 'primary' ? 'text-on-flood/80' : 'text-chalk-faint',
                )}
              >
                {shortcut}
              </kbd>
            )}
          </span>
          {loading && <span className="absolute inset-0 grid place-items-center">{spinner}</span>}
        </>
      )}
    </button>
  );
}

export type IconButtonProps = Omit<
  ButtonProps,
  'children' | 'leading' | 'trailing' | 'loadingText' | 'shortcut'
> & {
  /** Accessible name, also shown as the tooltip. Required: an icon alone has no name. */
  label: string;
  icon: ReactNode;
  /** Set false to skip the tooltip (for example inside a toolbar that labels itself). */
  tooltip?: boolean;
};

const ICON_BTN: Record<ButtonSize, string> = {
  sm: 'size-8 rounded-sm',
  md: 'size-10 rounded-md',
  lg: 'size-12 rounded-md',
};

export function IconButton({
  label,
  icon,
  tooltip = true,
  size = 'md',
  variant = 'ghost',
  className,
  ...rest
}: IconButtonProps) {
  const btn = (
    <Button
      aria-label={label}
      size={size}
      variant={variant}
      className={clsx(ICON_BTN[size], 'px-0!', className)}
      {...rest}
    >
      {icon}
    </Button>
  );
  return tooltip ? (
    <Tooltip content={label} describe={false}>
      {btn}
    </Tooltip>
  ) : (
    btn
  );
}

export type TooltipProps = {
  content: ReactNode;
  /** One focusable element (a button, a link). */
  children: ReactElement<Record<string, unknown>>;
  side?: 'top' | 'bottom';
  /** Milliseconds before it shows on hover. Focus shows it at once. */
  delay?: number;
  /** Adds aria-describedby to the trigger. Off when the content repeats the trigger's own name. */
  describe?: boolean;
  /** Optional shortcut drawn in the bubble. */
  shortcut?: string;
};

export function Tooltip({
  content,
  children,
  side = 'top',
  delay = 350,
  describe = true,
  shortcut,
}: TooltipProps) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reduced = useReducedMotion();
  const clear = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
  };
  const show = (wait: number) => {
    clear();
    timer.current = setTimeout(() => setOpen(true), wait);
  };
  const hide = () => {
    clear();
    setOpen(false);
  };
  useEffect(() => clear, []);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: globalThis.KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  const trigger = isValidElement(children)
    ? cloneElement(children, describe && open ? { 'aria-describedby': id } : {})
    : children;
  const dy = side === 'top' ? 4 : -4;
  return (
    <span
      data-ds=""
      className="relative inline-flex"
      onPointerEnter={() => show(delay)}
      onPointerLeave={hide}
      onFocus={(e) => (e.target as HTMLElement).matches(':focus-visible') && show(0)}
      onBlur={hide}
    >
      {trigger}
      <AnimatePresence>
        {open && (
          <motion.span
            id={id}
            role="tooltip"
            initial={{ opacity: 0, y: reduced ? 0 : dy, x: '-50%' }}
            animate={{ opacity: 1, y: 0, x: '-50%' }}
            exit={{ opacity: 0, x: '-50%', transition: { duration: DURATION.instant } }}
            transition={{ duration: reduced ? DURATION.fast : DURATION.base, ease: EASE_OUT }}
            className={clsx(
              'pointer-events-none absolute left-1/2 z-50 flex items-center gap-2 whitespace-nowrap rounded-sm border border-night-600 bg-night-800 px-2.5 py-1.5 text-sm font-medium text-chalk shadow-pop',
              side === 'top' ? 'bottom-full mb-2' : 'top-full mt-2',
            )}
          >
            {content}
            {shortcut && <Kbd size="sm">{shortcut}</Kbd>}
          </motion.span>
        )}
      </AnimatePresence>
    </span>
  );
}

export type KbdProps = { children: ReactNode; size?: 'sm' | 'md'; className?: string };

/** A keycap. One key per Kbd: `<Kbd>⌘</Kbd><Kbd>K</Kbd>`. */
export function Kbd({ children, size = 'md', className }: KbdProps) {
  return (
    <kbd
      data-ds=""
      className={clsx(
        'inline-flex items-center justify-center rounded-[5px] border border-night-600 border-b-[2px] bg-night-800 font-mono font-medium leading-none text-chalk-dim shadow-hairline',
        size === 'sm'
          ? 'h-[18px] min-w-[18px] px-1 text-[10.5px]'
          : 'h-[22px] min-w-[22px] px-1.5 text-xs',
        className,
      )}
    >
      {children}
    </kbd>
  );
}

export type SwitchProps = {
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  label: ReactNode;
  /** Visually hide the label (it stays the accessible name). */
  hideLabel?: boolean;
  disabled?: boolean;
  className?: string;
};

export function Switch({
  checked,
  onCheckedChange,
  label,
  hideLabel,
  disabled,
  className,
}: SwitchProps) {
  const reduced = useReducedMotion();
  return (
    <button
      data-ds=""
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onCheckedChange(!checked)}
      className={clsx(
        'group inline-flex cursor-pointer items-center gap-2.5 rounded-sm text-md font-medium text-chalk-dim transition-colors duration-fast hover:text-chalk disabled:cursor-not-allowed disabled:opacity-45',
        className,
      )}
    >
      <span
        className={clsx(
          'relative inline-flex h-[22px] w-[38px] items-center rounded-full border p-[2px] transition-[background-color,border-color,box-shadow] duration-base ease-out-expo',
          checked
            ? 'border-flood-400/60 bg-flood-500 shadow-[0_0_14px_-2px_rgb(255_154_31/0.6)]'
            : 'border-night-600 bg-night-800 group-hover:border-chalk-faint/60',
        )}
      >
        <motion.span
          className={clsx(
            'block size-4 rounded-full shadow-[0_1px_2px_rgb(0_0_0/0.5)]',
            checked ? 'bg-on-flood' : 'bg-chalk-dim',
          )}
          animate={{ x: checked ? 16 : 0 }}
          transition={reduced ? { duration: 0 } : SPRING.pop}
        />
      </span>
      <span className={clsx(hideLabel && 'sr-only')}>{label}</span>
    </button>
  );
}

export type SegmentedOption<T extends string> = { value: T; label: ReactNode };
export type SegmentedProps<T extends string> = {
  options: SegmentedOption<T>[];
  value: T;
  onValueChange: (value: T) => void;
  /** Accessible name of the group. */
  label: string;
  size?: 'sm' | 'md';
  className?: string;
};

/** A radio group drawn as a segmented control. Arrow keys move and select, like native radios. */
export function Segmented<T extends string>({
  options,
  value,
  onValueChange,
  label,
  size = 'md',
  className,
}: SegmentedProps<T>) {
  const id = useId();
  const reduced = useReducedMotion();
  const refs = useRef<Array<HTMLButtonElement | null>>([]);
  const onKey = (e: KeyboardEvent, i: number) => {
    const d =
      e.key === 'ArrowRight' || e.key === 'ArrowDown'
        ? 1
        : e.key === 'ArrowLeft' || e.key === 'ArrowUp'
          ? -1
          : 0;
    if (!d) return;
    e.preventDefault();
    const n = (i + d + options.length) % options.length;
    const next = options[n];
    if (!next) return;
    onValueChange(next.value);
    refs.current[n]?.focus();
    play('tick');
  };
  return (
    <div
      data-ds=""
      role="radiogroup"
      aria-label={label}
      className={clsx(
        'inline-flex rounded-md border border-night-600 bg-night-900 p-[3px] shadow-hairline',
        className,
      )}
    >
      {options.map((o, i) => {
        const on = o.value === value;
        return (
          <button
            key={o.value}
            ref={(el) => {
              refs.current[i] = el;
            }}
            type="button"
            role="radio"
            aria-checked={on}
            tabIndex={on ? 0 : -1}
            onClick={() => onValueChange(o.value)}
            onKeyDown={(e) => onKey(e, i)}
            className={clsx(
              'relative cursor-pointer rounded-sm font-medium transition-colors duration-fast',
              size === 'sm' ? 'h-7 px-2.5 text-sm' : 'h-8 px-3.5 text-md',
              on ? 'text-chalk' : 'text-chalk-dim hover:text-chalk',
            )}
          >
            {on && (
              <motion.span
                layoutId={`seg-${id}`}
                transition={reduced ? { duration: 0 } : SPRING.card}
                className="absolute inset-0 rounded-sm border border-night-600 bg-night-700 shadow-raise"
              />
            )}
            <span className="relative">{o.label}</span>
          </button>
        );
      })}
    </div>
  );
}

export type TabItem = {
  id: string;
  label: ReactNode;
  icon?: ReactNode;
  badge?: ReactNode;
  content: ReactNode;
};
export type TabsProps = {
  items: TabItem[];
  /** Controlled value; leave out for an uncontrolled tab set starting at `defaultValue` or the first tab. */
  value?: string;
  defaultValue?: string;
  onValueChange?: (id: string) => void;
  /** Accessible name for the tab list. */
  label: string;
  className?: string;
  panelClassName?: string;
};

/** WAI-ARIA tabs: arrow keys and Home/End move focus and select (automatic activation), plays `tick`. */
export function Tabs({
  items,
  value,
  defaultValue,
  onValueChange,
  label,
  className,
  panelClassName,
}: TabsProps) {
  const base = useId();
  const reduced = useReducedMotion();
  const [inner, setInner] = useState(defaultValue ?? items[0]?.id ?? '');
  const current = value ?? inner;
  const refs = useRef<Record<string, HTMLButtonElement | null>>({});
  const select = useCallback(
    (id: string) => {
      if (value === undefined) setInner(id);
      onValueChange?.(id);
    },
    [value, onValueChange],
  );
  const onKey = (e: KeyboardEvent) => {
    const i = items.findIndex((t) => t.id === current);
    let n = -1;
    if (e.key === 'ArrowRight') n = (i + 1) % items.length;
    else if (e.key === 'ArrowLeft') n = (i - 1 + items.length) % items.length;
    else if (e.key === 'Home') n = 0;
    else if (e.key === 'End') n = items.length - 1;
    if (n < 0) return;
    e.preventDefault();
    const t = items[n];
    if (!t) return;
    select(t.id);
    refs.current[t.id]?.focus();
    play('tick');
  };
  const active = items.find((t) => t.id === current);
  return (
    <div data-ds="" className={className}>
      <div
        role="tablist"
        aria-label={label}
        onKeyDown={onKey}
        className="relative flex gap-1 border-b border-night-600"
      >
        {items.map((t) => {
          const on = t.id === current;
          return (
            <button
              key={t.id}
              ref={(el) => {
                refs.current[t.id] = el;
              }}
              id={`${base}-tab-${t.id}`}
              role="tab"
              type="button"
              aria-selected={on}
              aria-controls={`${base}-panel-${t.id}`}
              tabIndex={on ? 0 : -1}
              onClick={() => select(t.id)}
              className={clsx(
                'relative -mb-px inline-flex h-10 cursor-pointer items-center gap-2 rounded-t-sm px-3.5 text-md font-medium transition-colors duration-fast',
                on ? 'text-chalk' : 'text-chalk-dim hover:bg-night-800/60 hover:text-chalk',
              )}
            >
              {t.icon}
              {t.label}
              {t.badge}
              {on && (
                <motion.span
                  layoutId={`tab-${base}`}
                  transition={reduced ? { duration: 0 } : SPRING.card}
                  className="absolute inset-x-2 -bottom-px h-[2px] rounded-full bg-flood-500 shadow-[0_0_12px_rgb(255_154_31/0.7)]"
                />
              )}
            </button>
          );
        })}
      </div>
      {active && (
        <div
          key={active.id}
          id={`${base}-panel-${active.id}`}
          role="tabpanel"
          aria-labelledby={`${base}-tab-${active.id}`}
          tabIndex={0}
          className={clsx('pt-4 focus-visible:rounded-sm', panelClassName)}
        >
          {active.content}
        </div>
      )}
    </div>
  );
}
