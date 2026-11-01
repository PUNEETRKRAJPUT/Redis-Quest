import { IconCheck, IconSpinner, IconWarn } from '../icons';
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

function checkLabel(level: LevelData, c: CheckResult): string {
  const v = level.verifiers.find((x) => x.index === c.index);
  const type = c.type ?? v?.type ?? 'check';
  return `Check ${c.index + 1}: ${type}`;
}

/** Progress rows while the request is in flight, then the per-check results from the response. */
export function ChecksList({
  level,
  result,
  verifying,
}: {
  level: LevelData;
  result: VerifyResponse | null;
  verifying: boolean;
}) {
  const events = useQuest((s) => s.events);
  const rows: { key: number; label: string; state: 'pending' | 'ok' | 'fail'; message?: string }[] =
    result?.checks?.length
      ? result.checks.map((c) => ({
          key: c.index,
          label: checkLabel(level, c),
          state: c.ok ? 'ok' : 'fail',
          message: c.message,
        }))
      : level.verifiers.map((v) => ({
          key: v.index,
          label: `Check ${v.index + 1}: ${v.type}`,
          state: 'pending' as const,
        }));
  if (!verifying && !result?.checks?.length) return null;
  const live = verifying ? events.slice(-4) : [];
  return (
    <div className="checks" data-testid="checks">
      <ul>
        {rows.map((r) => (
          <li
            key={r.key}
            className={`check ${r.state}`}
            data-state={verifying ? 'running' : r.state}
          >
            <span className="check-icon">
              {verifying ? (
                <IconSpinner size={16} />
              ) : r.state === 'ok' ? (
                <IconCheck size={16} />
              ) : (
                <IconWarn size={16} />
              )}
            </span>
            <span className="check-body">
              <strong>{r.label}</strong>
              {!verifying && r.message ? <span className="check-msg">{r.message}</span> : null}
            </span>
          </li>
        ))}
      </ul>
      {live.length ? (
        <p className="muted live" aria-live="polite">
          {live.map((e) => e.name ?? e.kind).join('  /  ')}
        </p>
      ) : null}
    </div>
  );
}

export function VerdictBanner({ result }: { result: VerifyResponse }) {
  const c = VERDICT_COPY[result.verdict] ?? VERDICT_COPY.not_implemented;
  const failing = (result.checks ?? []).filter((x) => !x.ok && x.message);
  return (
    <div
      className={`verdict ${c.tone}`}
      role="status"
      data-testid="verdict"
      data-verdict={result.verdict}
    >
      <h3>{c.title}</h3>
      <p>{c.lead}</p>
      {typeof result.feedback === 'string' && result.feedback ? <p>{result.feedback}</p> : null}
      {result.verdict === 'works_but_wrong' && failing.length ? (
        <ul>
          {failing.map((f) => (
            <li key={f.index}>{f.message}</li>
          ))}
        </ul>
      ) : null}
      <p className="muted small-print">
        Attempt {result.attempts}
        {typeof result.durationMs === 'number' ? `, took ${Math.round(result.durationMs)} ms` : ''}.
      </p>
    </div>
  );
}
