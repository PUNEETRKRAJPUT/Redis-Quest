'use client';
// The workspace of an ops level: the work happens in a terminal on the player's Mac, so this pane shows what the
// game can see from the outside: the stack's lights and the events it has noticed, newest first.
import { clsx } from 'clsx';
import { ArrowRight, Laptop, Radar } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { Button, EASE_OUT, Pill } from '../design';
import { useQuest } from '../store';

function clock(at: string): string {
  const d = new Date(at);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleTimeString([], { hour12: false });
}

export function OpsWatch({ onOpenTask }: { onOpenTask: () => void }) {
  const redisUp = useQuest((s) => s.redisUp);
  const health = useQuest((s) => s.health);
  const events = useQuest((s) => s.events);
  const recent = events.slice(-8).reverse();
  const lights: { name: string; up: boolean | null }[] = [
    { name: 'Redis', up: redisUp },
    { name: 'Postgres', up: health ? health.postgres === 'up' : null },
    { name: 'Engine', up: health ? health.ok : null },
  ];
  return (
    <div className="flex min-h-full flex-col gap-6 p-6" data-testid="ops-watch">
      <div className="flex items-start gap-4">
        <span className="grid size-12 shrink-0 place-items-center rounded-lg border border-flood-500/40 bg-flood-500/10 text-flood-400 shadow-glow">
          <Laptop size={22} aria-hidden />
        </span>
        <div className="min-w-0">
          <h3 className="m-0 font-display text-2xl font-semibold uppercase tracking-[0.03em] text-chalk">
            This one happens on your Mac
          </h3>
          <p className="mb-0 mt-1.5 max-w-[60ch] text-base leading-relaxed text-chalk-dim">
            Run the commands from step 5 in a terminal on your Mac, in the Redis Quest folder. The
            game watches from the outside; when you have done it, check your work.
          </p>
          <Button
            variant="ghost"
            size="sm"
            className="mt-3"
            trailing={<ArrowRight size={14} aria-hidden />}
            onClick={onOpenTask}
          >
            Show me step 5
          </Button>
        </div>
      </div>

      <div>
        <div className="label-caps mb-2 text-xs text-chalk-dim">The stack, right now</div>
        <div className="flex flex-wrap gap-2">
          {lights.map((l) => (
            <Pill
              key={l.name}
              variant="status"
              tone={l.up === null ? 'neutral' : l.up ? 'turf' : 'wicket'}
              live={l.up === true}
            >
              {l.name} {l.up === null ? 'checking' : l.up ? 'up' : 'down'}
            </Pill>
          ))}
        </div>
      </div>

      <div className="flex min-h-0 flex-1 flex-col">
        <div className="mb-2 flex items-center gap-2">
          <Radar size={14} aria-hidden className="ds-still animate-live text-sky" />
          <span className="label-caps text-xs text-chalk-dim">What the game has seen</span>
        </div>
        <ol
          className="m-0 flex list-none flex-col gap-1 rounded-md border border-night-600/60 bg-night-950/70 p-2 font-mono text-sm"
          aria-live="polite"
        >
          {recent.length === 0 ? (
            <li className="px-2 py-3 text-chalk-dim">
              Nothing yet. Events appear here the moment the game notices them.
            </li>
          ) : null}
          <AnimatePresence initial={false}>
            {recent.map((e, i) => (
              <motion.li
                key={e.seq}
                layout
                initial={{ opacity: 0, x: -8 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ duration: 0.22, ease: EASE_OUT }}
                className={clsx(
                  'flex items-baseline gap-3 rounded-sm px-2 py-1.5',
                  i === 0 ? 'bg-sky/10 text-chalk' : 'text-chalk-dim',
                )}
              >
                <span className="tabular shrink-0 text-xs text-chalk-dim">{clock(e.at)}</span>
                <span className="min-w-0 truncate">{e.name ?? e.kind}</span>
              </motion.li>
            ))}
          </AnimatePresence>
        </ol>
      </div>
    </div>
  );
}

/** A quiet card for a pane with no tool open. */
export function IdleTools() {
  return (
    <div className="grid h-full place-items-center p-8 text-center">
      <div>
        <p className="m-0 font-display text-xl font-semibold uppercase tracking-[0.04em] text-chalk-dim">
          No tool open
        </p>
        <p className="mb-0 mt-1.5 text-md text-chalk-dim">
          Open the terminal, the editor, the logs or the metrics from the tabs above.
        </p>
      </div>
    </div>
  );
}
