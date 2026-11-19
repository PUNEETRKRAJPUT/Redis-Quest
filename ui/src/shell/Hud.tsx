'use client';

// The scoreboard bar: brand, the six screens, and on the right the stack light, the player's rank and XP in flip
// digits, a sound toggle, the palette and the shortcuts. One row, 56px, quieter than the page below it.

import { clsx } from 'clsx';
import { motion } from 'motion/react';
import { Search, Volume2, VolumeX } from 'lucide-react';
import { usePathname } from 'next/navigation';
import { Suspense, useSyncExternalStore } from 'react';
import { Button, IconButton, Kbd, Tooltip } from '@/design/components/controls';
import { FlipNumber } from '@/design/components/data';
import { SPRING, useReducedMotion } from '@/design/motion';
import { useSettings } from '@/design/settings';
import { play } from '@/design/sound';
import { rankFor } from '../game/rank';
import { IconBall } from '../icons';
import { parsePath } from '../routes';
import type { Route } from '../routes';
import { useQuest } from '../store';
import { QuestLink } from './QuestLink';
import { NAV, isActive } from './nav';
import { stackLight } from './rain';

const noop = () => () => undefined;
/** Cmd on a Mac, Ctrl elsewhere. The server and the first client render say Ctrl, then it settles. */
export function useModKey(): string {
  const mac = useSyncExternalStore(
    noop,
    () => /Mac|iPhone|iPad/i.test(navigator.platform || navigator.userAgent),
    () => false,
  );
  return mac ? '⌘' : 'Ctrl';
}

export function Brand() {
  return (
    <QuestLink
      to={{ name: 'home' }}
      aria-label="Redis Quest, home"
      className="group/brand flex shrink-0 items-center gap-2.5 rounded-md py-1 pr-2"
    >
      <span className="relative grid size-8 place-items-center rounded-md border border-night-600 bg-night-800 text-flood-400 shadow-[inset_0_1px_0_rgb(255_255_255/0.06),0_0_18px_-4px_rgb(255_154_31/0.55)] transition-shadow duration-base group-hover/brand:shadow-[inset_0_1px_0_rgb(255_255_255/0.08),0_0_24px_-2px_rgb(255_154_31/0.8)]">
        <IconBall size={20} />
      </span>
      <span className="label-caps max-lg:hidden text-lg font-bold leading-none tracking-[0.1em] text-chalk">
        Redis <span className="text-flood-400">Quest</span>
      </span>
    </QuestLink>
  );
}

// usePathname suspends while prerendering a route whose params are only known at request time (/level/[id]), so
// the links live in their own Suspense boundary; the fallback is the same links with none marked active.
export function NavLinks({ current }: { current: Route | null }) {
  const reduced = useReducedMotion();
  return (
    <nav aria-label="Main" className="flex items-center gap-0.5">
      {NAV.map((n) => {
        const Icon = n.icon;
        const on = isActive(n, current);
        return (
          <Tooltip
            key={n.id}
            content={n.label}
            shortcut={`G ${n.key.toUpperCase()}`}
            side="bottom"
            describe={false}
          >
            <QuestLink
              to={n.route}
              aria-current={on ? 'page' : undefined}
              className={clsx(
                'relative flex h-10 items-center gap-2 rounded-md px-3 text-md font-medium transition-colors duration-fast',
                on
                  ? 'bg-[linear-gradient(to_top,rgb(255_154_31/0.13),transparent_80%)] text-chalk'
                  : 'text-chalk-dim hover:bg-night-800/80 hover:text-chalk active:bg-night-700',
              )}
            >
              <Icon size={16} aria-hidden className={clsx(on && 'text-flood-400')} />
              <span className={clsx('whitespace-nowrap', !on && 'max-[1239px]:sr-only')}>
                {n.label}
              </span>
              {on && (
                <motion.span
                  layoutId="hud-active"
                  aria-hidden
                  transition={reduced ? { duration: 0 } : SPRING.card}
                  className="absolute inset-x-2 -bottom-[9px] h-[2px] rounded-full bg-flood-500 shadow-[0_0_10px_1px_rgb(255_154_31/0.7)]"
                />
              )}
            </QuestLink>
          </Tooltip>
        );
      })}
    </nav>
  );
}

function ActiveNav() {
  const pathname = usePathname();
  return <NavLinks current={parsePath(pathname ?? '/')} />;
}

const LIGHT = {
  live: { dot: 'bg-turf shadow-glow-turf animate-live ds-still', text: 'text-turf' },
  reconnecting: { dot: 'bg-flood-500', text: 'text-flood-400' },
  'redis down': { dot: 'bg-wicket shadow-glow-wicket', text: 'text-wicket' },
} as const;

/** The stack light. `conn-state` carries the same words as before: live, reconnecting, redis down. */
export function StatusLight({
  ws,
  redisUp,
}: {
  ws: 'connecting' | 'open' | 'closed';
  redisUp: boolean | null;
}) {
  const s = stackLight(ws, redisUp);
  const look = LIGHT[s.text];
  return (
    <div className="flex h-8 items-center gap-2 rounded-full border border-night-600/70 bg-night-900/70 pl-3 pr-3.5">
      <span
        role="img"
        aria-label={s.label}
        className={clsx('block size-2 rounded-full', look.dot)}
      />
      <span
        data-testid="conn-state"
        className={clsx('label-caps text-sm leading-none tracking-[0.12em]', look.text)}
      >
        {s.text}
      </span>
    </div>
  );
}

/** Player, rank and XP: the scoreboard plate. A link to the career page; the line along its foot is the way to the next rank. */
export function ScorePlate({ name, xp }: { name: string; xp: number }) {
  const r = rankFor(xp);
  const tip = r.next ? `${r.toNext} XP to ${r.next.title}` : 'Top of the ladder';
  return (
    <Tooltip content={tip} side="bottom" describe={false}>
      <QuestLink
        to={{ name: 'built' }}
        data-testid="score-plate"
        aria-label={`${name}, ${r.rank.title}, ${xp} XP. ${tip}.`}
        className="group/plate relative flex h-10 items-center gap-3.5 rounded-md border border-night-600/70 bg-night-900/70 px-3 shadow-[inset_0_1px_0_rgb(255_255_255/0.04)] transition-colors duration-fast hover:border-chalk-faint/50 hover:bg-night-800"
      >
        <span className="flex min-w-0 flex-col">
          <span className="label-caps max-w-[120px] truncate text-md leading-[15px] text-chalk">
            {name}
          </span>
          <span className="label-caps whitespace-nowrap max-[1399px]:hidden text-[11px] leading-[13px] tracking-[0.1em] text-chalk-dim">
            {r.rank.title}
          </span>
        </span>
        <span className="flex items-baseline gap-1.5">
          <FlipNumber value={xp} minDigits={4} size="sm" tone="flood" label="XP" />
          <span
            aria-hidden
            className="label-caps text-[11px] leading-none tracking-[0.12em] text-chalk-dim"
          >
            XP
          </span>
        </span>
        <span
          aria-hidden
          className="absolute inset-x-2.5 bottom-[3px] h-[2px] overflow-hidden rounded-full bg-night-700"
        >
          <span
            className="block h-full origin-left rounded-full bg-flood-500 shadow-[0_0_6px_rgb(255_154_31/0.8)] motion-ok:transition-transform motion-ok:duration-slow motion-ok:ease-out-expo"
            style={{ transform: `scaleX(${Math.max(0.02, r.progress)})` }}
          />
        </span>
      </QuestLink>
    </Tooltip>
  );
}

export function Hud({
  onPalette,
  onShortcuts,
  mod,
}: {
  onPalette: () => void;
  onShortcuts: () => void;
  mod: string;
}) {
  const progress = useQuest((s) => s.progress);
  const ws = useQuest((s) => s.wsState);
  const redisUp = useQuest((s) => s.redisUp);
  const sound = useSettings((s) => s.sound);
  const toggleSound = useSettings((s) => s.toggleSound);
  return (
    <header
      data-ds=""
      className="relative flex h-14 items-center gap-3 border-b border-night-600/70 bg-night-950/85 px-4 backdrop-blur-md before:pointer-events-none before:absolute before:inset-x-0 before:top-0 before:h-full before:bg-[radial-gradient(40%_120%_at_50%_-40%,rgb(255_154_31/0.08),transparent)]"
    >
      <Brand />
      <Suspense fallback={<NavLinks current={null} />}>
        <ActiveNav />
      </Suspense>
      <div className="relative ml-auto flex items-center gap-2.5">
        <StatusLight ws={ws} redisUp={redisUp} />
        {progress ? <ScorePlate name={progress.player.name} xp={progress.xp} /> : null}
        <span aria-hidden className="mx-0.5 h-6 w-px bg-night-600/70" />
        <IconButton
          label={sound ? 'Turn sound off' : 'Turn sound on'}
          icon={sound ? <Volume2 size={16} className="text-flood-400" /> : <VolumeX size={16} />}
          variant="quiet"
          size="sm"
          onClick={() => {
            toggleSound();
            if (useSettings.getState().sound) play('tick');
          }}
        />
        <Tooltip content="Command palette" shortcut={`${mod} K`} side="bottom" describe={false}>
          <Button
            variant="ghost"
            size="sm"
            aria-label="Search, command palette"
            onClick={onPalette}
            leading={<Search size={14} aria-hidden />}
            className="text-chalk-dim"
          >
            <span className="max-[1399px]:hidden">Search</span>
            <Kbd size="sm" className="ml-1 max-[1399px]:hidden">
              {mod}
            </Kbd>
            <Kbd size="sm" className="max-[1399px]:hidden">
              K
            </Kbd>
          </Button>
        </Tooltip>
        <IconButton
          label="Keyboard shortcuts"
          icon={<span className="font-display text-lg font-bold leading-none">?</span>}
          variant="quiet"
          size="sm"
          onClick={onShortcuts}
        />
      </div>
    </header>
  );
}
