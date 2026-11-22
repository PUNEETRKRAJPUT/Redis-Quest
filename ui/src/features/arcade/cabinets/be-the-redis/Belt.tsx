'use client';
import { AnimatePresence, motion } from 'motion/react';
import { clsx } from 'clsx';
import { Pill, SPRING } from '@/design';
import { PATIENCE_TICKS, sizeText, type Client } from './logic';

/** How many clients fit on the belt at 1280 wide; the rest are counted. */
export const BELT_VISIBLE = 6;

function tone(c: Client): 'calm' | 'worried' | 'angry' {
  const f = c.patience / PATIENCE_TICKS;
  return f > 0.5 ? 'calm' : f > 0.25 ? 'worried' : 'angry';
}

const EDGE = {
  calm: 'border-night-600',
  worried: 'border-flood-500/60',
  angry: 'border-wicket/70',
} as const;
const BAR = { calm: 'bg-turf', worried: 'bg-flood-500', angry: 'bg-wicket' } as const;

function ClientCard({ client, first }: { client: Client; first: boolean }) {
  const t = tone(client);
  const pct = Math.max(0, Math.min(100, (client.patience / PATIENCE_TICKS) * 100));
  return (
    <>
      <div className="flex items-center justify-between gap-2">
        <span className="label-caps text-[11px] text-chalk-dim">Client {client.id}</span>
        {first && (
          <Pill tone="flood" size="sm">
            Next
          </Pill>
        )}
      </div>
      <div className="mt-1.5 truncate font-mono text-md font-medium text-chalk">
        {client.command}
      </div>
      <div className="truncate font-mono text-xs text-chalk-dim">{client.args}</div>
      <div className="tabular mt-1 truncate text-xs text-chalk-dim">
        {client.swapped
          ? `call ${client.totalSteps - client.steps + 1} of ${client.totalSteps}`
          : sizeText(client)}
      </div>
      <div
        aria-hidden
        className="mt-2 h-1.5 overflow-hidden rounded-full bg-night-950"
        data-testid="patience"
      >
        <div className={clsx('h-full rounded-full', BAR[t])} style={{ width: `${pct}%` }} />
      </div>
    </>
  );
}

const CARD = 'w-[158px] shrink-0 rounded-md border bg-night-800 p-2.5 shadow-raise';

/**
 * The line of waiting clients, front first. With full motion a card slides when the one ahead of it leaves; with
 * reduced motion the belt steps: the cards simply sit in their new places.
 */
export function Belt({ queue, reduced }: { queue: readonly Client[]; reduced: boolean }) {
  const shown = queue.slice(0, BELT_VISIBLE);
  const hidden = queue.length - shown.length;
  return (
    <div className="flex min-h-[132px] items-stretch gap-3 overflow-hidden" data-testid="belt">
      {queue.length === 0 && (
        <p className="self-center text-sm text-chalk-dim">
          No one is waiting. The next client is on the way.
        </p>
      )}
      {reduced ? (
        <ol className="flex gap-3" aria-label="Clients waiting, front of the line first">
          {shown.map((c, i) => (
            <li
              key={c.id}
              data-testid="client"
              className={clsx(CARD, EDGE[tone(c)], i === 0 && 'shadow-glow')}
            >
              <ClientCard client={c} first={i === 0} />
            </li>
          ))}
        </ol>
      ) : (
        <ol className="flex gap-3" aria-label="Clients waiting, front of the line first">
          <AnimatePresence initial={false} mode="popLayout">
            {shown.map((c, i) => (
              <motion.li
                key={c.id}
                layout
                data-testid="client"
                initial={{ opacity: 0, x: 36 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, y: -16 }}
                transition={SPRING.card}
                className={clsx(CARD, EDGE[tone(c)], i === 0 && 'shadow-glow')}
              >
                <ClientCard client={c} first={i === 0} />
              </motion.li>
            ))}
          </AnimatePresence>
        </ol>
      )}
      {hidden > 0 && (
        <div
          className="grid w-[72px] shrink-0 place-items-center rounded-md border border-dashed border-night-600 text-center"
          data-testid="belt-more"
        >
          <span className="tabular font-display text-xl font-semibold text-chalk">+{hidden}</span>
          <span className="label-caps text-[11px] text-chalk-dim">waiting</span>
        </div>
      )}
    </div>
  );
}
