import { dotPositions, summarizeSpread } from './spread';
import { formatMs } from './waterfall';

/** Twenty requests as dots from the fastest to the slowest, with the numbers that matter. */
export function SpreadStrip({
  samples,
  failures,
}: {
  samples: readonly number[];
  failures: number;
}) {
  const s = summarizeSpread(samples);
  if (!s) return null;
  const dots = dotPositions(samples);
  return (
    <div data-testid="phone-spread" className="flex flex-col gap-2">
      <div className="relative h-5 rounded-sm bg-night-800/80" aria-hidden>
        {dots.map((p, i) => (
          <span
            key={i}
            className="absolute top-1/2 size-2 -translate-x-1/2 -translate-y-1/2 rounded-full bg-flood-500/70"
            style={{ left: `${Math.min(97, Math.max(3, p))}%` }}
          />
        ))}
      </div>
      <dl className="grid grid-cols-4 gap-2 text-center">
        {[
          ['fastest', s.minMs],
          ['median', s.p50Ms],
          ['90th', s.p90Ms],
          ['slowest', s.maxMs],
        ].map(([k, v]) => (
          <div key={k as string}>
            <dt className="label-caps text-[10px] text-chalk-dim">{k}</dt>
            <dd className="tabular font-mono text-sm text-chalk">{formatMs(v as number)}</dd>
          </div>
        ))}
      </dl>
      <p className="text-xs text-chalk-dim">
        {s.n} requests, one after another, as your browser saw them (mean {formatMs(s.meanMs)})
        {failures > 0 ? `; ${failures} failed` : ''}.
      </p>
    </div>
  );
}
