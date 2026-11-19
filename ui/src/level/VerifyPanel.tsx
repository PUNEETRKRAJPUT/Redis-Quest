'use client';
// The scoreboard of checks and the verdict card. Each check is a row with a clear mark; a failed check shows what
// the engine expected and what it saw (when its details carry them), failing rows first.
import { clsx } from 'clsx';
import { Check, Info, TriangleAlert, X } from 'lucide-react';
import type { Ref } from 'react';
import { evidenceOf, orderChecks } from '../match/decision';
import { useQuest } from '../store';
import type { CheckResult, LevelData, Verdict, VerifyResponse } from '../types';

export const VERDICT_COPY: Record<
  Verdict,
  { title: string; tone: 'ok' | 'warn' | 'bad' | 'info'; lead: string }
> = {
  right: {
    title: 'Right',
    tone: 'ok',
    lead: 'Every check passed and nothing in your solution tripped a known anti-pattern.',
  },
  works_but_wrong: {
    title: 'It works, but it will not survive the final',
    tone: 'warn',
    lead: 'This passes today. The notes below say how it fails under the IPL-final crowd.',
  },
  wrong: {
    title: 'Not yet',
    tone: 'bad',
    lead: 'At least one check failed. Each failure below says what it saw and what to look at first.',
  },
  not_implemented: {
    title: 'Verifier not installed',
    tone: 'info',
    lead: 'This engine build cannot grade levels yet (the verifier engine, task P0-09, has not landed). Nothing was checked.',
  },
};

/** What each kind of check looks at, in plain words. */
const KIND: Record<string, string> = {
  redis: 'Redis state',
  antipattern: 'Anti-pattern scan',
  behavior: 'Your code, called for real',
  traffic: 'Under load',
  event: 'Watching for it',
  quiz: 'Your choice',
  answer: 'Your answer',
};

export function checkKind(type: string | undefined): string {
  return (type && KIND[type]) ?? type ?? 'Check';
}

type Row = {
  key: number;
  index: number;
  type: string | undefined;
  state: 'pending' | 'ok' | 'fail';
  message?: string;
  details?: unknown;
};

function typeOf(level: LevelData, c: Pick<CheckResult, 'index' | 'type'>): string | undefined {
  return c.type ?? level.verifiers.find((x) => x.index === c.index)?.type;
}

/** Progress rows while the request is in flight, then the per-check results from the response. */
export function ChecksList({
  level,
  result,
  verifying,
  firstFailRef,
}: {
  level: LevelData;
  result: VerifyResponse | null;
  verifying: boolean;
  /** Receives the first failing row, so a failed check can take focus. */
  firstFailRef?: Ref<HTMLLIElement>;
}) {
  const events = useQuest((s) => s.events);
  const rows: Row[] = result?.checks?.length
    ? orderChecks(result.checks).map((c) => ({
        key: c.index,
        index: c.index,
        type: typeOf(level, c),
        state: c.ok ? 'ok' : 'fail',
        message: c.message,
        details: c.details,
      }))
    : level.verifiers.map((v) => ({
        key: v.index,
        index: v.index,
        type: v.type,
        state: 'pending' as const,
      }));
  if (!verifying && !result?.checks?.length) return null;
  const live = verifying ? events.slice(-4) : [];
  const passedCount = rows.filter((r) => r.state === 'ok').length;
  let firstFail = true;
  return (
    <div className="flex flex-col gap-2" data-testid="checks">
      <div className="flex items-baseline justify-between px-0.5">
        <span className="label-caps text-xs text-chalk-dim">
          {verifying ? 'Checks running' : 'Checks'}
        </span>
        {!verifying ? (
          <span className="tabular font-display text-lg font-bold leading-none text-chalk">
            {passedCount}
            <span className="text-chalk-dim"> / {rows.length}</span>
            <span className="sr-only"> checks passed</span>
          </span>
        ) : null}
      </div>
      <ul className="m-0 flex list-none flex-col gap-1.5 p-0">
        {rows.map((r, i) => {
          const state = verifying ? 'running' : r.state;
          const evidence = state === 'fail' ? evidenceOf(r.details) : [];
          const isFirstFail = state === 'fail' && firstFail;
          if (isFirstFail) firstFail = false;
          return (
            <li
              key={r.key}
              ref={isFirstFail ? firstFailRef : undefined}
              tabIndex={isFirstFail ? -1 : undefined}
              data-state={state}
              style={verifying ? { animationDelay: `${Math.min(i, 10) * 120}ms` } : undefined}
              className={clsx(
                'flex gap-3 rounded-md border px-3 py-2.5 outline-none',
                'focus-visible:ring-2 focus-visible:ring-sky',
                state === 'fail' && 'border-wicket/40 bg-wicket/[0.07]',
                state === 'ok' && 'border-night-600/60 bg-night-950/40',
                state === 'running' && 'border-night-600/60 bg-night-950/40',
              )}
            >
              <span
                aria-hidden
                className={clsx(
                  'mt-0.5 grid size-5 shrink-0 place-items-center rounded-full border',
                  state === 'ok' && 'border-turf/50 bg-turf/15 text-turf',
                  state === 'fail' && 'border-wicket/60 bg-wicket/20 text-wicket',
                  state === 'running' && 'border-flood-500/50 text-flood-400',
                  state === 'pending' && 'border-night-600',
                )}
              >
                {state === 'ok' ? (
                  <Check size={12} strokeWidth={3} />
                ) : state === 'fail' ? (
                  <X size={12} strokeWidth={3} />
                ) : (
                  <span
                    className="ds-still size-1.5 animate-live rounded-full bg-flood-500"
                    style={{ animationDelay: `${i * 160}ms` }}
                  />
                )}
              </span>
              <span className="flex min-w-0 flex-1 flex-col gap-1">
                <span className="flex items-baseline gap-2">
                  <strong
                    className={clsx(
                      'text-md font-semibold',
                      state === 'ok' ? 'text-chalk-dim' : 'text-chalk',
                    )}
                  >
                    {checkKind(r.type)}
                  </strong>
                  <span className="tabular ml-auto font-mono text-[11px] text-chalk-dim">
                    #{r.index + 1}
                    <span className="sr-only">
                      {state === 'ok' ? ', passed' : state === 'fail' ? ', failed' : ', running'}
                    </span>
                  </span>
                </span>
                {!verifying && r.message ? (
                  <span
                    className={clsx(
                      'break-words text-sm leading-relaxed',
                      state === 'fail' ? 'text-chalk' : 'text-chalk-dim',
                    )}
                  >
                    {r.message}
                  </span>
                ) : null}
                {evidence.length ? (
                  <dl className="m-0 mt-1 flex flex-col gap-1.5">
                    {evidence.map((e, k) => (
                      <div
                        key={k}
                        className="grid grid-cols-[4.5rem_1fr] gap-x-2 gap-y-0.5 rounded-sm bg-night-950/70 px-2 py-1.5 font-mono text-xs leading-snug"
                      >
                        {e.label ? (
                          <span className="col-span-2 truncate text-chalk-dim" title={e.label}>
                            {e.label}
                          </span>
                        ) : null}
                        <dt className="label-caps font-display text-[11px] text-turf">Expected</dt>
                        <dd className="m-0 break-words text-chalk">{e.expected}</dd>
                        <dt className="label-caps font-display text-[11px] text-wicket">Got</dt>
                        <dd className="m-0 break-words text-chalk">{e.actual}</dd>
                      </div>
                    ))}
                  </dl>
                ) : null}
              </span>
            </li>
          );
        })}
      </ul>
      {live.length ? (
        <p className="m-0 truncate px-0.5 font-mono text-xs text-chalk-dim" aria-live="polite">
          {live.map((e) => e.name ?? e.kind).join('  /  ')}
        </p>
      ) : null}
    </div>
  );
}

const TONE_BOX = {
  ok: 'border-turf/45 bg-[radial-gradient(120%_90%_at_0%_0%,rgb(46_226_129/0.16),transparent_60%)] shadow-glow-turf',
  warn: 'border-flood-500/55 bg-[repeating-linear-gradient(135deg,rgb(255_154_31/0.07)_0_10px,transparent_10px_20px)] shadow-glow',
  bad: 'border-wicket/45 bg-[radial-gradient(120%_90%_at_0%_0%,rgb(255_84_104/0.13),transparent_60%)]',
  info: 'border-sky/40 bg-sky/5',
} as const;
const TONE_TEXT = { ok: 'text-turf', warn: 'text-flood-400', bad: 'text-wicket', info: 'text-sky' };

export function VerdictBanner({ result }: { result: VerifyResponse }) {
  const c = VERDICT_COPY[result.verdict] ?? VERDICT_COPY.not_implemented;
  const failing = (result.checks ?? []).filter((x) => !x.ok && x.message);
  const Icon =
    c.tone === 'ok' ? Check : c.tone === 'warn' ? TriangleAlert : c.tone === 'bad' ? X : Info;
  return (
    <div
      className={clsx('relative overflow-hidden rounded-lg border p-4', TONE_BOX[c.tone])}
      role="status"
      data-testid="verdict"
      data-verdict={result.verdict}
    >
      <div className="flex items-start gap-3">
        <span
          aria-hidden
          className={clsx(
            'grid size-9 shrink-0 place-items-center rounded-full border-2 bg-night-950/60',
            c.tone === 'ok' && 'border-turf text-turf',
            c.tone === 'warn' && 'border-flood-500 text-flood-400',
            c.tone === 'bad' && 'border-wicket text-wicket',
            c.tone === 'info' && 'border-sky text-sky',
          )}
        >
          <Icon size={18} strokeWidth={3} />
        </span>
        <div className="min-w-0 flex-1">
          <div className="label-caps text-[11px] text-chalk-dim">Decision</div>
          <h3
            className={clsx(
              'm-0 font-display text-xl font-bold uppercase leading-tight tracking-[0.02em]',
              TONE_TEXT[c.tone],
            )}
          >
            {c.title}
          </h3>
        </div>
      </div>
      <p className="mb-0 mt-2.5 text-sm leading-relaxed text-chalk">{c.lead}</p>
      {typeof result.feedback === 'string' && result.feedback ? (
        <p className="mb-0 mt-2 text-sm leading-relaxed text-chalk">{result.feedback}</p>
      ) : null}
      {result.verdict === 'works_but_wrong' && failing.length ? (
        <ul className="mb-0 mt-2.5 flex list-none flex-col gap-1.5 p-0">
          {failing.map((f) => (
            <li
              key={f.index}
              className="flex gap-2 rounded-sm border border-flood-500/30 bg-night-950/60 px-2.5 py-2 text-sm leading-relaxed text-chalk"
            >
              <TriangleAlert size={14} aria-hidden className="mt-0.5 shrink-0 text-flood-400" />
              <span>{f.message}</span>
            </li>
          ))}
        </ul>
      ) : null}
      <p className="mb-0 mt-3 font-mono text-xs text-chalk-dim">
        Attempt {result.attempts}
        {typeof result.durationMs === 'number' ? `, took ${Math.round(result.durationMs)} ms` : ''}.
      </p>
    </div>
  );
}
