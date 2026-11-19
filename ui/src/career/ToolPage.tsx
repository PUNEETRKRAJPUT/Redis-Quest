import type { ReactNode } from 'react';

/** The frame every tool page shares: an eyebrow, the screen title, one plain sentence, then the content. */
export function ToolPage({
  eyebrow,
  title,
  blurb,
  actions,
  children,
  testId,
}: {
  eyebrow: string;
  title: string;
  blurb?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  testId?: string;
}) {
  return (
    <main
      data-ds=""
      data-testid={testId}
      className="mx-auto flex w-full max-w-[1320px] flex-col gap-6 px-6 pb-10 pt-8"
    >
      <header className="flex flex-wrap items-end gap-x-6 gap-y-3">
        <div className="min-w-0 flex-1">
          <div className="label-caps text-xs text-flood-400">{eyebrow}</div>
          <h1 className="mt-1 font-display text-3xl font-bold uppercase leading-none tracking-[0.02em] text-chalk">
            {title}
          </h1>
          {blurb ? <p className="mt-2 max-w-2xl text-md text-chalk-dim">{blurb}</p> : null}
        </div>
        {actions}
      </header>
      {children}
    </main>
  );
}
