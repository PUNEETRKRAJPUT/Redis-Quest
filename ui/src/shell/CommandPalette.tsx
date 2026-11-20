'use client';

// Cmd/Ctrl+K: go to any screen, jump to any level by title (locked ones are shown but disabled), toggle sound,
// toggle reduced motion, open the shortcuts sheet. Built on cmdk, inside a native <dialog> like the design Dialog,
// so focus is trapped, the page behind is inert and Escape closes it.

import { Command } from 'cmdk';
import { clsx } from 'clsx';
import {
  Circle,
  CircleCheck,
  CircleDot,
  Keyboard,
  Lock,
  Search,
  Volume2,
  VolumeX,
  Wind,
  type LucideIcon,
} from 'lucide-react';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Kbd } from '@/design/components/controls';
import { useReducedMotion } from '@/design/motion';
import { useSettings } from '@/design/settings';
import { play } from '@/design/sound';
import { toast } from '@/design/toast';
import type { Route } from '../routes';
import { useQuest } from '../store';
import type { LevelStatus } from '../types';
import { FEATURES } from '../features/registry';
import { NAV } from './nav';
import { paletteScore } from './paletteScore';

const ITEM =
  'flex h-10 cursor-pointer select-none items-center gap-3 rounded-md px-3 text-md text-chalk-dim ' +
  'data-[selected=true]:bg-night-700 data-[selected=true]:text-chalk ' +
  'data-[disabled=true]:cursor-not-allowed data-[disabled=true]:opacity-50';

const GROUP =
  '[&_[cmdk-group-heading]]:label-caps [&_[cmdk-group-heading]]:px-3 [&_[cmdk-group-heading]]:pb-1 ' +
  '[&_[cmdk-group-heading]]:pt-3 [&_[cmdk-group-heading]]:text-sm [&_[cmdk-group-heading]]:text-chalk-dim';

const STATUS_ICON: Record<LevelStatus, { icon: LucideIcon; className: string; label: string }> = {
  passed: { icon: CircleCheck, className: 'text-turf', label: 'Passed' },
  in_progress: { icon: CircleDot, className: 'text-flood-400', label: 'In progress' },
  available: { icon: Circle, className: 'text-sky', label: 'Open' },
  locked: { icon: Lock, className: 'text-chalk-faint', label: 'Locked' },
};

function Row({
  icon: Icon,
  iconClass,
  children,
  hint,
}: {
  icon: LucideIcon;
  iconClass?: string;
  children: ReactNode;
  hint?: ReactNode;
}) {
  return (
    <>
      <Icon size={16} aria-hidden className={clsx('shrink-0', iconClass ?? 'text-chalk-faint')} />
      <span className="min-w-0 flex-1 truncate">{children}</span>
      {hint && (
        <span className="flex shrink-0 items-center gap-1.5 text-xs text-chalk-dim">{hint}</span>
      )}
    </>
  );
}

export function CommandPalette({
  open,
  onClose,
  onShortcuts,
  go,
}: {
  open: boolean;
  onClose: () => void;
  onShortcuts: () => void;
  /** Navigates with the shell's own cross-fade. */
  go: (to: Route | string) => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const [search, setSearch] = useState('');
  const [session, setSession] = useState(0);
  const chapters = useQuest((s) => s.chapters);
  const sound = useSettings((s) => s.sound);
  const toggleSound = useSettings((s) => s.toggleSound);
  const setReducedMotion = useSettings((s) => s.setReducedMotion);
  const reduced = useReducedMotion();

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) {
      d.showModal();
      d.querySelector('input')?.focus();
    }
    if (!open && d.open) d.close();
    if (!open) {
      // The next opening starts clean.
      const t = setTimeout(() => {
        setSearch('');
        setSession((n) => n + 1);
      }, 250);
      return () => clearTimeout(t);
    }
  }, [open]);

  const run = (fn: () => void) => () => {
    onClose();
    fn();
  };

  return (
    <dialog
      ref={ref}
      data-ds=""
      aria-label="Command palette"
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      className="ds-dialog mx-auto mb-auto mt-[12vh] w-[min(92vw,640px)] overflow-hidden rounded-xl border border-night-600 bg-night-900 p-0 text-chalk shadow-pop"
    >
      <Command
        label="Command palette"
        filter={paletteScore}
        loop
        // Uncontrolled selection (cmdk picks the first match itself); the key remounts it for a clean start.
        key={session}
        onValueChange={() => {
          if (open) play('tick');
        }}
        className="flex max-h-[min(70vh,560px)] flex-col"
      >
        <div className="flex items-center gap-3 border-b border-night-600/70 px-4 transition-colors duration-fast focus-within:border-flood-500/50">
          <Search size={18} aria-hidden className="shrink-0 text-flood-400" />
          <Command.Input
            value={search}
            onValueChange={setSearch}
            placeholder="Go to a screen or a level..."
            aria-label="Search screens and levels"
            // The row's amber edge is this field's focus mark; the global 2px ring would be clipped by the dialog.
            style={{ outline: 'none' }}
            className="h-14 min-w-0 flex-1 bg-transparent text-base text-chalk outline-none placeholder:text-chalk-faint"
          />
          <Kbd size="sm">Esc</Kbd>
        </div>
        <Command.List className="min-h-0 flex-1 overflow-auto px-2 pb-2">
          <Command.Empty className="px-3 py-8 text-center text-md text-chalk-dim">
            Nothing matches. Try a level title or a screen name.
          </Command.Empty>

          <Command.Group heading="Go to" className={GROUP}>
            {NAV.map((n) => (
              <Command.Item
                key={n.id}
                value={`go ${n.label}`}
                keywords={['screen', 'open', n.id]}
                onSelect={run(() => go(n.route))}
                className={ITEM}
              >
                <Row
                  icon={n.icon}
                  hint={
                    <>
                      <Kbd size="sm">G</Kbd>
                      <Kbd size="sm">{n.key.toUpperCase()}</Kbd>
                    </>
                  }
                >
                  {n.label}
                </Row>
              </Command.Item>
            ))}
          </Command.Group>

          {FEATURES.length > 0 ? (
            <Command.Group heading="Beyond the season" className={GROUP}>
              {FEATURES.map((f) => (
                <Command.Item
                  key={f.id}
                  value={`go ${f.label}`}
                  keywords={['screen', 'open', f.id]}
                  onSelect={run(() => go(f.path))}
                  className={ITEM}
                >
                  <Row icon={f.icon}>{f.label}</Row>
                </Command.Item>
              ))}
            </Command.Group>
          ) : null}

          <Command.Group heading="Settings" className={GROUP}>
            <Command.Item
              value="toggle sound"
              keywords={['audio', 'mute', 'volume', 'cues']}
              onSelect={run(() => {
                toggleSound();
                const on = useSettings.getState().sound;
                toast({ title: on ? 'Sound on' : 'Sound off', duration: 1800 });
                if (on) play('tick');
              })}
              className={ITEM}
            >
              <Row icon={sound ? Volume2 : VolumeX} hint={sound ? 'On' : 'Off'}>
                Toggle sound
              </Row>
            </Command.Item>
            <Command.Item
              value="toggle reduced motion"
              keywords={['animation', 'accessibility', 'reduce', 'calm']}
              onSelect={run(() => {
                setReducedMotion(reduced ? 'off' : 'on');
                toast({ title: reduced ? 'Full motion' : 'Reduced motion', duration: 1800 });
              })}
              className={ITEM}
            >
              <Row icon={Wind} hint={reduced ? 'On' : 'Off'}>
                Toggle reduced motion
              </Row>
            </Command.Item>
            <Command.Item
              value="keyboard shortcuts"
              keywords={['help', 'keys', 'hotkeys']}
              onSelect={run(onShortcuts)}
              className={ITEM}
            >
              <Row icon={Keyboard} hint={<Kbd size="sm">?</Kbd>}>
                Show keyboard shortcuts
              </Row>
            </Command.Item>
          </Command.Group>

          {chapters?.chapters.map((ch, ci) => (
            <Command.Group key={ch.id} heading={`Chapter ${ci} · ${ch.title}`} className={GROUP}>
              {ch.levels.map((lv) => {
                const st = STATUS_ICON[lv.status];
                const locked = lv.status === 'locked';
                return (
                  <Command.Item
                    key={lv.id}
                    value={`${lv.title} · ${lv.id}`}
                    keywords={[ch.title, lv.mode, 'jump']}
                    disabled={locked}
                    onSelect={run(() => go({ name: 'level', id: lv.id }))}
                    className={ITEM}
                  >
                    <Row
                      icon={st.icon}
                      iconClass={st.className}
                      hint={locked ? 'Locked' : `${lv.xp} XP`}
                    >
                      {lv.title}
                      <span className="sr-only"> ({st.label})</span>
                    </Row>
                  </Command.Item>
                );
              })}
            </Command.Group>
          ))}
        </Command.List>
        <div className="flex items-center gap-4 border-t border-night-600/70 bg-night-950/40 px-4 py-2.5 text-xs text-chalk-dim">
          <span className="flex items-center gap-1.5">
            <Kbd size="sm">↑</Kbd>
            <Kbd size="sm">↓</Kbd> move
          </span>
          <span className="flex items-center gap-1.5">
            <Kbd size="sm">↵</Kbd> open
          </span>
          <span className="ml-auto">Locked levels are not open yet</span>
        </div>
      </Command>
    </dialog>
  );
}
