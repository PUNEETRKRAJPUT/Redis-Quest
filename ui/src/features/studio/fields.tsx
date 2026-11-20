'use client';
import { clsx } from 'clsx';
import { useId, type ReactNode } from 'react';

export const INPUT =
  'w-full rounded-md border border-night-600 bg-night-900 px-3 text-md text-chalk placeholder:text-chalk-faint';

export function Field({
  label,
  hint,
  htmlFor,
  children,
  className,
}: {
  label: string;
  hint?: ReactNode;
  htmlFor: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={clsx('flex min-w-0 flex-col gap-1', className)}>
      <label htmlFor={htmlFor} className="text-sm font-semibold text-chalk">
        {label}
      </label>
      {children}
      {hint ? <p className="m-0 text-xs leading-snug text-chalk-dim">{hint}</p> : null}
    </div>
  );
}

export function TextInput({
  label,
  value,
  onChange,
  placeholder,
  hint,
  mono,
  className,
  inputMode,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  hint?: ReactNode;
  mono?: boolean;
  className?: string;
  inputMode?: 'numeric' | 'text';
}) {
  const id = useId();
  return (
    <Field label={label} hint={hint} htmlFor={id} className={className}>
      <input
        id={id}
        className={clsx(INPUT, 'h-9', mono && 'font-mono text-sm')}
        value={value}
        placeholder={placeholder}
        inputMode={inputMode}
        autoComplete="off"
        spellCheck={false}
        onChange={(e) => onChange(e.target.value)}
      />
    </Field>
  );
}

export function TextArea({
  label,
  value,
  onChange,
  rows = 4,
  placeholder,
  hint,
  mono,
  className,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  rows?: number;
  placeholder?: string;
  hint?: ReactNode;
  mono?: boolean;
  className?: string;
}) {
  const id = useId();
  return (
    <Field label={label} hint={hint} htmlFor={id} className={className}>
      <textarea
        id={id}
        className={clsx(INPUT, 'py-2 leading-relaxed', mono && 'font-mono text-sm')}
        rows={rows}
        value={value}
        placeholder={placeholder}
        spellCheck={mono ? false : undefined}
        onChange={(e) => onChange(e.target.value)}
      />
    </Field>
  );
}

export function Select({
  label,
  value,
  onChange,
  options,
  hint,
  className,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: readonly { value: string; label: string }[];
  hint?: ReactNode;
  className?: string;
}) {
  const id = useId();
  return (
    <Field label={label} hint={hint} htmlFor={id} className={className}>
      <select
        id={id}
        className={clsx(INPUT, 'h-9')}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </Field>
  );
}

export function Tick({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  const id = useId();
  return (
    <label htmlFor={id} className="flex cursor-pointer items-center gap-2 text-sm text-chalk">
      <input
        id={id}
        type="checkbox"
        className="size-4 accent-[var(--color-flood-500)]"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
      />
      {label}
    </label>
  );
}

/** An immutable update of one list item. */
export function patchAt<T>(list: readonly T[], i: number, patch: Partial<T>): T[] {
  return list.map((x, n) => (n === i ? { ...x, ...patch } : x));
}

export function removeAt<T>(list: readonly T[], i: number): T[] {
  return list.filter((_, n) => n !== i);
}
