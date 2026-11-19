'use client';

import { clsx } from 'clsx';
import { AnimatePresence, motion } from 'motion/react';
import { useLayoutEffect, useState } from 'react';
import { Button, Card, Dialog, pop, useReducedMotion, variantsFor } from '@/design';
import { CapEmblem } from './CapEmblem';
import s from './map.module.css';
import { useRoving } from './roving';

/** How many caps the shelf on the map shows before "all caps" takes over. */
export const SHELF_PREVIEW = 8;

function Cap({
  name,
  size,
  showName,
  rove,
}: {
  name: string;
  size: number;
  showName?: boolean;
  rove: ReturnType<ReturnType<typeof useRoving>['item']>;
}) {
  return (
    <span
      {...rove}
      role="img"
      aria-label={name}
      className={clsx(
        'group/cap relative flex flex-col items-center gap-1.5 rounded-md outline-offset-2',
        s.capHost,
      )}
    >
      <span
        className="relative inline-grid transition-transform duration-base ease-snap [filter:drop-shadow(0_5px_6px_rgb(0_0_0/0.55))] motion-ok:group-hover/cap:-translate-y-1 motion-ok:group-hover/cap:rotate-[-4deg]"
        style={{ width: size, height: size }}
      >
        <CapEmblem name={name} size={size} />
        <span className={clsx('ds-still', s.shine)} aria-hidden="true" />
      </span>
      {showName ? (
        <span
          aria-hidden="true"
          className="line-clamp-2 max-w-[96px] text-center text-xs leading-tight text-chalk-dim"
        >
          {name}
        </span>
      ) : (
        <span
          aria-hidden="true"
          className="pointer-events-none absolute left-1/2 top-full z-30 mt-1 -translate-x-1/2 whitespace-nowrap rounded-sm border border-night-600 bg-night-800 px-2 py-1 text-xs font-medium text-chalk opacity-0 shadow-pop transition-opacity duration-fast group-hover/cap:opacity-100 group-focus-visible/cap:opacity-100"
        >
          {name}
        </span>
      )}
    </span>
  );
}

/** A row of caps standing on a lit ledge. */
function Shelf({
  names,
  size,
  showName,
  label,
  extra,
}: {
  names: string[];
  size: number;
  showName?: boolean;
  label: string;
  extra?: React.ReactNode;
}) {
  const reduced = useReducedMotion();
  const { ref, onKeyDown, item } = useRoving<HTMLUListElement>(names.length);
  return (
    <ul
      ref={ref}
      onKeyDown={onKeyDown}
      aria-label={label}
      className="grid gap-x-3 gap-y-4 pb-4 bg-[repeating-linear-gradient(180deg,transparent_0,transparent_calc(var(--row)-7px),rgb(39_50_92/0.9)_calc(var(--row)-7px),rgb(17_24_51)_calc(var(--row)-2px),transparent_calc(var(--row)-2px),transparent_var(--row))] [grid-template-columns:repeat(auto-fill,minmax(var(--cell),1fr))]"
      style={
        {
          '--cell': `${size + 8}px`,
          '--row': `${size + (showName ? 52 : 16)}px`,
        } as React.CSSProperties
      }
    >
      <AnimatePresence initial={false}>
        {names.map((n, i) => (
          <motion.li
            key={n}
            layout={!reduced}
            variants={variantsFor(pop, reduced)}
            initial="hidden"
            animate="show"
            exit="exit"
            className="flex justify-center"
          >
            <Cap name={n} size={size} showName={showName} rove={item(i)} />
          </motion.li>
        ))}
      </AnimatePresence>
      {extra}
    </ul>
  );
}

/**
 * The caps shelf: every badge as an enamel cap, newest first. The map shows the newest few; the rest open in a
 * dialog where each cap carries its name.
 */
export function CapsShelf({ badges }: { badges: string[] }) {
  const [all, setAll] = useState(false);
  useLayoutEffect(() => () => setAll(false), []);
  // The engine appends badges as they are earned: newest first means reversed.
  const newest = [...badges].reverse();
  const preview = newest.length > SHELF_PREVIEW ? newest.slice(0, SHELF_PREVIEW - 1) : newest;
  const more = newest.length - preview.length;
  return (
    // `badges`: the end-to-end tests find the shelf by this class and read the names in its text. A flex row, so
    // the single card child fills it.
    <div className="badges flex h-full">
      <Card
        padding="none"
        data-testid="caps-shelf"
        role="region"
        aria-labelledby="caps-title"
        className="flex h-full w-full flex-col bg-[radial-gradient(120%_80%_at_50%_0%,rgb(181_140_255/0.1),transparent_60%)]"
      >
        <header className="flex items-baseline justify-between gap-3 px-5 pt-4">
          <h2 id="caps-title" className="label-caps text-md text-chalk">
            Caps shelf
          </h2>
          <span className="tabular text-sm text-chalk-dim" data-testid="caps-count">
            {badges.length} {badges.length === 1 ? 'cap' : 'caps'}
          </span>
        </header>
        {badges.length === 0 ? (
          <div className="flex flex-1 items-center gap-4 px-5 pb-5 pt-3">
            <span
              aria-hidden="true"
              className="grid size-16 shrink-0 place-items-center rounded-full border-2 border-dashed border-cap-purple/50 bg-night-950/50 font-display text-2xl font-bold text-cap-purple/70"
            >
              ?
            </span>
            <p className="text-sm leading-snug text-chalk-dim">
              <span className="block font-semibold text-chalk">Your first cap is waiting.</span>
              Pass levels to earn caps. Each one lands here, newest first.
            </p>
          </div>
        ) : (
          <div className="flex-1 px-5 pb-4 pt-4">
            <Shelf
              names={preview}
              size={56}
              label="Badges earned, newest first"
              extra={
                more > 0 ? (
                  <li className="flex justify-center">
                    <button
                      type="button"
                      onClick={() => setAll(true)}
                      aria-haspopup="dialog"
                      className="grid size-14 cursor-pointer place-items-center rounded-full border border-dashed border-cap-purple/60 bg-cap-purple/10 font-display text-lg font-bold text-cap-purple transition-colors duration-fast hover:bg-cap-purple/20"
                    >
                      +{more}
                      <span className="sr-only"> more caps: show all</span>
                    </button>
                  </li>
                ) : null
              }
            />
            {/* the names that did not fit, for screen readers (and the tests, which read the shelf's text) */}
            {more > 0 ? (
              <ul className="sr-only" aria-label="More badges">
                {newest.slice(preview.length).map((b) => (
                  <li key={b}>{b}</li>
                ))}
              </ul>
            ) : null}
          </div>
        )}
        {badges.length > 0 ? (
          <footer className="flex items-center justify-between gap-3 border-t border-night-600/60 px-5 py-2.5">
            <span className="text-xs text-chalk-dim">Newest first</span>
            <Button variant="quiet" size="sm" onClick={() => setAll(true)} aria-haspopup="dialog">
              All caps
            </Button>
          </footer>
        ) : null}
        <Dialog
          open={all}
          onClose={() => setAll(false)}
          title={`Your caps: ${badges.length}`}
          description="Every badge you have earned, newest first."
          size="lg"
        >
          <div className="max-h-[60vh] overflow-y-auto px-1 pt-8">
            {all ? <Shelf names={newest} size={60} showName label="All badges earned" /> : null}
          </div>
        </Dialog>
      </Card>
    </div>
  );
}
