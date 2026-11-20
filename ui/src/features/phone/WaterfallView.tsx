import { clsx } from 'clsx';
import type { ParsedTrace } from './trace';
import { formatMs, layoutWaterfall, summarizeTrace } from './waterfall';

/** The request as a waterfall: one bar per Redis command or query, so ten round trips are ten bars. */
export function Waterfall({ trace }: { trace: ParsedTrace | null }) {
  if (!trace) {
    return (
      <p className="text-sm text-chalk-dim" data-testid="phone-waterfall-empty">
        No trace came back with this answer, so there is no waterfall to draw.
      </p>
    );
  }
  if (trace.calls === 0) {
    return (
      <p className="text-sm text-chalk-dim" data-testid="phone-waterfall-empty">
        This request made no Redis command and no database query.
      </p>
    );
  }
  const layout = layoutWaterfall(trace.rows, trace.totalMs);
  const sum = summarizeTrace(trace.rows);
  const hidden = trace.calls - trace.rows.length;
  return (
    <div data-testid="phone-waterfall" className="flex flex-col gap-2">
      <p className="text-sm text-chalk-dim">
        {sum.redis} Redis {sum.redis === 1 ? 'command' : 'commands'}, {sum.db}{' '}
        {sum.db === 1 ? 'query' : 'queries'}
        {sum.sequential && trace.rows.length > 1 ? ', each waiting for the one before' : ''}.
      </p>
      <ol className="flex flex-col gap-1" aria-label="Calls in order">
        {layout.bars.map((b, i) => (
          <li
            key={i}
            className="grid grid-cols-[minmax(0,9.5rem)_minmax(0,1fr)_3.5rem] items-center gap-2"
          >
            <span className="truncate font-mono text-xs text-chalk-dim" title={b.row.label}>
              {b.row.label}
            </span>
            <span className="relative h-3 rounded-xs bg-night-800/80">
              <span
                data-testid="phone-bar"
                title={`${b.row.label}: ${formatMs(b.row.ms)} at ${formatMs(b.row.startMs)}, ${
                  b.row.by === 'learner' ? 'your code' : 'built-in'
                }${b.row.ok ? '' : ', failed'}`}
                className={clsx(
                  'absolute inset-y-0 rounded-xs',
                  !b.row.ok ? 'bg-wicket' : b.row.kind === 'db' ? 'bg-sky' : 'bg-flood-500',
                )}
                style={{ left: `${b.leftPct}%`, width: `${b.widthPct}%` }}
              />
            </span>
            <span className="tabular text-right font-mono text-xs text-chalk">
              {formatMs(b.row.ms)}
            </span>
          </li>
        ))}
      </ol>
      <div className="grid grid-cols-[minmax(0,9.5rem)_minmax(0,1fr)_3.5rem] gap-2" aria-hidden>
        <span />
        <span className="relative h-4">
          {layout.ticks.map((t, i) => (
            <span
              key={i}
              className={clsx(
                'absolute font-mono text-[10px] text-chalk-faint',
                i === layout.ticks.length - 1 ? 'right-0' : '',
              )}
              style={i === layout.ticks.length - 1 ? undefined : { left: `${t.pct}%` }}
            >
              {t.label}
            </span>
          ))}
        </span>
        <span />
      </div>
      <p className="flex flex-wrap gap-x-4 text-xs text-chalk-dim">
        <span className="inline-flex items-center gap-1.5">
          <span aria-hidden className="size-2 rounded-xs bg-flood-500" /> Redis
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span aria-hidden className="size-2 rounded-xs bg-sky" /> Database
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span aria-hidden className="size-2 rounded-xs bg-wicket" /> Failed
        </span>
        {hidden > 0 ? <span>{hidden} more not shown (the header is size-capped)</span> : null}
      </p>
    </div>
  );
}
