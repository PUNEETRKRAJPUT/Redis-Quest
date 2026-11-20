'use client';
import { Check, TriangleAlert, X } from 'lucide-react';
import { Pill } from '../../design';
import { VerdictBanner, checkKind } from '../../level/VerifyPanel';
import type { Playtest, PlaytestRun } from './client';

const VERDICT_LABEL = {
  right: 'Right',
  wrong: 'Wrong',
  works_but_wrong: 'Works, but wrong',
} as const;

function RunCard({ run }: { run: PlaytestRun }) {
  const label = run.name === 'reference' ? 'Reference solution' : `Known-wrong: ${run.name}`;
  return (
    <section
      className="flex flex-col gap-3 rounded-md border border-night-700 bg-night-900/60 p-3"
      data-testid={`run-${run.name}`}
    >
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="m-0 min-w-0 flex-1 break-all font-mono text-sm font-semibold text-chalk">
          {label}
        </h3>
        <Pill tone="neutral" size="sm">
          declared: {VERDICT_LABEL[run.expect]}
        </Pill>
        <Pill tone={run.ok ? 'turf' : 'wicket'} size="sm">
          got: {VERDICT_LABEL[run.verdict]}
        </Pill>
      </div>
      {run.because ? <p className="m-0 text-xs text-chalk-dim">{run.because}</p> : null}
      {run.transcript.length > 0 ? (
        <pre
          className="m-0 overflow-x-auto rounded-sm bg-night-950 p-2 font-mono text-xs leading-relaxed text-chalk"
          aria-label="What each command answered"
        >
          {run.transcript.map((t) => `$ ${t.line}\n${t.reply}`).join('\n')}
        </pre>
      ) : null}
      {run.name === 'reference' ? (
        <VerdictBanner result={{ ...run.outcome, attempts: 1, status: 'in_progress' }} />
      ) : null}
      <ul className="m-0 flex list-none flex-col gap-1.5 p-0" aria-label="Checks">
        {run.outcome.checks.map((c) => (
          <li
            key={c.index}
            className="flex gap-2 rounded-sm border border-night-700 px-2.5 py-2 text-sm leading-snug"
          >
            {c.ok ? (
              <Check size={14} aria-hidden className="mt-0.5 shrink-0 text-turf" />
            ) : c.type === 'antipattern' ? (
              <TriangleAlert size={14} aria-hidden className="mt-0.5 shrink-0 text-flood-400" />
            ) : (
              <X size={14} aria-hidden className="mt-0.5 shrink-0 text-wicket" />
            )}
            <span className="min-w-0">
              <span className="label-caps mr-2 text-[11px] text-chalk-dim">
                {checkKind(c.type)}
              </span>
              <span className="whitespace-pre-wrap text-chalk">{c.message}</span>
              <span className="sr-only">{c.ok ? ' passed' : ' failed'}</span>
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

export function PlaytestView({ result }: { result: Playtest }) {
  if (result.refused) {
    return (
      <div
        className="flex flex-col gap-2 rounded-md border border-wicket/45 bg-wicket/5 p-3"
        role="status"
        data-testid="playtest-refused"
      >
        <div className="label-caps text-xs text-wicket">Play-test did not run</div>
        <p className="m-0 text-sm leading-relaxed text-chalk">{result.refused}</p>
      </div>
    );
  }
  const okCount = result.runs.filter((r) => r.ok).length;
  return (
    <div className="flex flex-col gap-3" data-testid="playtest-result" data-passed={result.passed}>
      <div
        className={`rounded-md border p-3 ${result.passed ? 'border-turf/45 bg-turf/5' : 'border-wicket/45 bg-wicket/5'}`}
        role="status"
      >
        <div className={`label-caps text-xs ${result.passed ? 'text-turf' : 'text-wicket'}`}>
          {result.passed ? 'Play-test passed' : 'Play-test failed'}
        </div>
        <p className="m-0 mt-1 text-sm leading-relaxed text-chalk">
          {result.passed
            ? 'The reference solution is right and every known-wrong solution gets the verdict you declared. The keys it wrote were removed.'
            : `${okCount} of ${result.runs.length} runs behaved as declared. Fix the level (or the declaration) and run it again.`}
        </p>
      </div>
      {result.runs.map((r) => (
        <RunCard key={r.name} run={r} />
      ))}
    </div>
  );
}
