'use client';
import { GraduationCap, Keyboard, Pause, Play, RotateCcw } from 'lucide-react';
import type { ReactNode } from 'react';
import { Button, Kbd, Panel, Scoreline } from '@/design';
import { FactList } from './FactList';
import type { Cabinet } from './types';

export type FrameStatus = 'ready' | 'playing' | 'paused' | 'over';

export interface FrameScore {
  label: string;
  value: number | string;
  tone?: 'chalk' | 'flood' | 'turf';
  /** Flip digits when the value is a number. */
  flip?: boolean;
}

export interface CabinetFrameProps {
  cabinet: Pick<Cabinet, 'title' | 'pitch' | 'lesson' | 'facts' | 'keys'>;
  status: FrameStatus;
  scores: readonly FrameScore[];
  onPause: () => void;
  onResume: () => void;
  onRestart: () => void;
  /** Said to screen readers (polite) when something happens in the game. */
  announce?: string;
  /** Under the game, small print: what the player must know it is. */
  note?: ReactNode;
  children: ReactNode;
}

/**
 * What every cabinet shares: title, scores, pause and restart, the "what this teaches" panel with every rule's
 * source, and the keyboard help. The game goes in `children`; keys are handled by the cabinet itself.
 */
export function CabinetFrame({
  cabinet,
  status,
  scores,
  onPause,
  onResume,
  onRestart,
  announce,
  note,
  children,
}: CabinetFrameProps) {
  const playing = status === 'playing';
  const paused = status === 'paused';
  return (
    <section
      data-ds=""
      data-testid="cabinet"
      aria-label={cabinet.title}
      className="mx-auto w-full max-w-[1200px] px-6 py-6"
    >
      <header className="mb-5 flex flex-wrap items-end justify-between gap-x-8 gap-y-4">
        <div className="min-w-0">
          <div className="label-caps text-xs text-chalk-dim">Arcade</div>
          <h1 className="font-display text-2xl font-semibold uppercase tracking-display text-chalk">
            {cabinet.title}
          </h1>
          <p className="mt-1 max-w-[56ch] text-md text-chalk-dim">{cabinet.pitch}</p>
        </div>
        <div className="flex flex-wrap items-end gap-x-8 gap-y-3" data-testid="cabinet-scores">
          {scores.map((s) => (
            <Scoreline
              key={s.label}
              label={s.label}
              value={s.value}
              size="md"
              tone={s.tone ?? 'chalk'}
              flip={s.flip}
            />
          ))}
          <div className="flex items-center gap-2 pb-0.5">
            <Button
              variant="ghost"
              size="sm"
              leading={paused ? <Play size={14} aria-hidden /> : <Pause size={14} aria-hidden />}
              shortcut="P"
              disabled={!playing && !paused}
              onClick={paused ? onResume : onPause}
              data-testid="cabinet-pause"
            >
              {paused ? 'Resume' : 'Pause'}
            </Button>
            <Button
              variant="quiet"
              size="sm"
              leading={<RotateCcw size={14} aria-hidden />}
              shortcut="R"
              disabled={status === 'ready'}
              onClick={onRestart}
              data-testid="cabinet-restart"
            >
              Restart
            </Button>
          </div>
        </div>
      </header>

      <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="min-w-0">
          {children}
          {note && <div className="mt-3 text-xs leading-relaxed text-chalk-dim">{note}</div>}
        </div>

        <aside className="flex flex-col gap-4" aria-label="About this cabinet">
          <Panel title="What this teaches" as="h2" icon={<GraduationCap size={16} aria-hidden />}>
            <p className="text-base leading-relaxed text-chalk" data-testid="cabinet-lesson">
              {cabinet.lesson}
            </p>
            <details className="mt-4 group">
              <summary className="cursor-pointer text-sm font-medium text-sky">
                Where each rule comes from
              </summary>
              <div className="mt-3">
                <FactList facts={cabinet.facts} />
              </div>
            </details>
          </Panel>
          <Panel title="Keys" as="h2" icon={<Keyboard size={16} aria-hidden />}>
            <ul className="flex flex-col gap-2 text-sm text-chalk-dim">
              {cabinet.keys.map((k) => (
                <li key={k.keys.join('+') + k.does} className="flex items-center gap-3">
                  <span className="flex shrink-0 items-center gap-1">
                    {k.keys.map((key) => (
                      <Kbd key={key}>{key}</Kbd>
                    ))}
                  </span>
                  <span>{k.does}</span>
                </li>
              ))}
            </ul>
          </Panel>
        </aside>
      </div>

      <div role="status" aria-live="polite" className="sr-only" data-testid="cabinet-announce">
        {announce}
      </div>
    </section>
  );
}
