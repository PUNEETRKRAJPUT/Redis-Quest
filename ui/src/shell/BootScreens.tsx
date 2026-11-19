'use client';

// The three screens before the game is ready: `loading` (floodlights warming up), `offline` (rain delay, full
// page, the shell keeps retrying), `invalid` (the level-file errors as a list). Test ids and wording are the old
// shell's; only the look is new.

import { clsx } from 'clsx';
import { CloudRain, FileWarning } from 'lucide-react';
import type { CSSProperties, ReactNode } from 'react';
import { CommandChip } from './CommandChip';
import { STACK_COMMAND } from './rain';

function Stage({
  children,
  testId,
  rain,
}: {
  children: ReactNode;
  testId?: string;
  rain?: boolean;
}) {
  return (
    <main
      data-ds=""
      data-testid={testId}
      className="relative grid min-h-dvh place-items-center overflow-hidden px-6 py-16"
    >
      <span
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 h-[70vh] bg-[radial-gradient(60%_80%_at_50%_0%,rgb(255_154_31/0.11),transparent)]"
      />
      {rain && <span aria-hidden className="rq-rain ds-still" />}
      <div className="relative w-full max-w-[560px]">{children}</div>
    </main>
  );
}

export function BootLoading() {
  return (
    <Stage>
      <div role="status" className="flex flex-col items-center text-center">
        {/* A light tower: six lamps that come on one by one. */}
        <div aria-hidden className="relative mb-8 flex flex-col items-center">
          <div className="grid grid-cols-6 gap-x-3.5 gap-y-3 rounded-lg border border-night-600 bg-night-900 px-5 py-4 shadow-raise">
            {[0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11].map((i) => (
              <span
                key={i}
                style={{ '--i': i % 6 } as CSSProperties}
                className="rq-lamp ds-still size-[18px] rounded-full bg-flood-400 shadow-[0_0_20px_4px_rgb(255_154_31/0.5),inset_0_-2px_3px_rgb(230_126_0/0.6)]"
              />
            ))}
          </div>
          <span className="h-9 w-1.5 bg-linear-to-b from-night-600 to-transparent" />
        </div>
        <p className="label-caps text-2xl text-chalk">Floodlights warming up</p>
        <p className="mt-2 text-md text-chalk-dim">Starting...</p>
      </div>
    </Stage>
  );
}

export function BootOffline({ error }: { error: string | null }) {
  return (
    <Stage testId="offline" rain>
      <div className="rounded-xl border border-night-600 bg-night-900/90 p-8 shadow-pop backdrop-blur-sm">
        <div className="mb-5 flex items-center gap-3">
          <span className="grid size-10 place-items-center rounded-md bg-night-800 text-flood-400 shadow-hairline">
            <CloudRain size={20} aria-hidden />
          </span>
          <span className="label-caps text-md text-flood-400">Rain delay</span>
        </div>
        <h1 className="font-display text-3xl font-semibold uppercase leading-[1.05] tracking-[0.015em] text-chalk">
          The game engine is not answering
        </h1>
        {error && (
          <p className="mt-3 rounded-sm bg-night-950/70 px-3 py-2 font-mono text-sm leading-5 text-chalk-dim">
            {error}
          </p>
        )}
        <p className="mt-4 text-base leading-relaxed text-chalk-dim">
          Start the stack from the repo folder with{' '}
          <code className="rounded-xs bg-night-800 px-1.5 py-0.5 font-mono text-[0.9em] text-chalk">
            ./scripts/start
          </code>
          . This page keeps trying and will continue on its own.
        </p>
        <div className="mt-5 flex flex-wrap items-center justify-between gap-3">
          <CommandChip command={STACK_COMMAND} />
          <span className="flex items-center gap-2 text-sm text-chalk-dim" aria-hidden>
            <span className="ds-still size-2 animate-live rounded-full bg-flood-500" />
            Checking again every few seconds
          </span>
        </div>
      </div>
    </Stage>
  );
}

export function BootInvalid({ errors }: { errors: string[] }) {
  return (
    <Stage testId="levels-invalid">
      <div className="rounded-xl border border-wicket/40 bg-night-900/90 p-8 shadow-pop">
        <div className="mb-5 flex items-center gap-3">
          <span className="grid size-10 place-items-center rounded-md bg-wicket/10 text-wicket">
            <FileWarning size={20} aria-hidden />
          </span>
          <span className="label-caps text-md text-wicket">Play suspended</span>
        </div>
        <h1 className="font-display text-3xl font-semibold uppercase leading-[1.05] tracking-[0.015em] text-chalk">
          The level files have errors
        </h1>
        <p className="mt-3 text-base leading-relaxed text-chalk-dim">
          The engine refuses to run until they are fixed:
        </p>
        <ul
          className={clsx(
            'mt-4 max-h-[44vh] list-none space-y-2 overflow-auto rounded-md border border-night-600/70 bg-night-950/70 p-3',
            errors.length === 0 && 'hidden',
          )}
        >
          {errors.map((e, i) => (
            <li key={i} className="flex gap-3 text-sm leading-5">
              <span aria-hidden className="mt-0.5 shrink-0 font-mono text-xs text-wicket">
                {String(i + 1).padStart(2, '0')}
              </span>
              <code className="min-w-0 whitespace-pre-wrap break-words font-mono text-chalk">
                {e}
              </code>
            </li>
          ))}
        </ul>
      </div>
    </Stage>
  );
}
