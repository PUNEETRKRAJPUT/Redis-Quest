import { ArrowRight } from 'lucide-react';
import type { ImpactFigure, Impact } from '../impact';

function when(at: string | undefined): string | null {
  if (!at) return null;
  const d = new Date(at);
  return Number.isNaN(d.getTime())
    ? null
    : d.toLocaleString('en-US', {
        month: 'short',
        day: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
      });
}

function Figure({ f }: { f: ImpactFigure }) {
  const better = f.change !== undefined && (f.lowerIsBetter ? f.change < 0 : f.change > 0);
  return (
    <div className="flex min-w-0 flex-col gap-1.5" aria-hidden>
      <span className="label-caps text-[11px] text-chalk-dim">{f.label}</span>
      <span className="tabular flex items-baseline gap-2 font-display text-2xl font-bold leading-none">
        {f.before !== undefined ? (
          <>
            <span className="text-lg text-chalk-faint line-through decoration-chalk-faint/60">
              {f.before}
            </span>
            <ArrowRight size={15} className="self-center text-chalk-dim" />
          </>
        ) : null}
        <span className={f.before !== undefined ? 'text-turf' : 'text-chalk'}>{f.value}</span>
        {f.unit ? <span className="label-caps text-sm text-chalk-dim">{f.unit}</span> : null}
        {f.change !== undefined ? (
          <span
            className={
              better
                ? 'rounded-full border border-turf/35 bg-turf/10 px-2 py-0.5 font-mono text-[11px] font-semibold leading-none text-turf'
                : 'rounded-full border border-wicket/40 bg-wicket/10 px-2 py-0.5 font-mono text-[11px] font-semibold leading-none text-wicket'
            }
          >
            {f.change > 0 ? '+' : '−'}
            {Math.abs(f.change).toLocaleString('en-US')}%
          </span>
        ) : null}
      </span>
    </div>
  );
}

/** F-13: before and after numbers per passed level, read from the save. Levels without numbers are not listed. */
export function ImpactLog({ impact }: { impact: Impact }) {
  return (
    <section data-ds="" data-testid="impact-log" aria-labelledby="impact-log-title">
      <h2
        id="impact-log-title"
        className="font-display text-xl font-semibold uppercase tracking-[0.04em] text-chalk"
      >
        Impact log
      </h2>
      <p className="mt-1 text-md text-chalk-dim" data-testid="impact-summary">
        {impact.summary}
      </p>
      {impact.entries.length === 0 ? (
        <p className="mt-4 rounded-lg border border-dashed border-night-600 bg-night-900/60 px-5 py-6 text-md text-chalk-dim">
          No numbers yet. Levels that load-test your code or time your rebuild show up here.
        </p>
      ) : (
        <ol className="mt-5">
          {impact.entries.map((e, i) => {
            const date = when(e.at);
            return (
              <li
                key={e.levelId}
                data-testid={`impact-${e.levelId}`}
                className="relative grid grid-cols-[28px_minmax(0,1fr)] gap-x-3 pb-5 last:pb-0"
              >
                <span
                  aria-hidden
                  className={`absolute left-[13px] w-px bg-night-600 ${i === 0 ? 'top-3' : 'top-0'} ${i === impact.entries.length - 1 ? 'h-3' : 'bottom-0'}`}
                />
                <span
                  aria-hidden
                  className="relative z-10 mt-1.5 size-[11px] place-self-start justify-self-center rounded-full border-2 border-night-900 bg-turf shadow-[0_0_0_1px_var(--color-turf),0_0_12px_rgb(46_226_129/0.7)]"
                />
                <div className="min-w-0 rounded-lg border border-night-600 bg-night-800 p-4 shadow-raise">
                  <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                    <strong className="font-display text-lg font-semibold uppercase tracking-[0.03em] text-chalk">
                      {e.title}
                    </strong>
                    <span className="text-sm text-chalk-dim">{e.chapter}</span>
                    {date ? (
                      <time
                        dateTime={e.at}
                        className="tabular ml-auto font-mono text-xs text-chalk-dim"
                      >
                        {date}
                      </time>
                    ) : null}
                  </div>
                  <div className="mt-3 flex flex-wrap gap-x-8 gap-y-4">
                    {e.figures.map((f) => (
                      <Figure key={f.key} f={f} />
                    ))}
                  </div>
                  <ul className="sr-only">
                    {e.phrases.map((p) => (
                      <li key={p}>{p}</li>
                    ))}
                  </ul>
                </div>
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}
