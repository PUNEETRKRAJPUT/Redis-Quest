import { Card, Pill, Scoreline } from '@/design';
import { failureHeadline, rankSentence, underParLabel } from './logic';
import type { ScoreOutcome } from './types';

/** What "Score it" answered: the scorecard, or why there is none. Announced politely when it changes. */
export function Scorecard({ outcome }: { outcome: ScoreOutcome | null }) {
  return (
    <div role="status" aria-live="polite" data-testid="league-scorecard">
      {outcome === null ? null : <Body outcome={outcome} />}
    </div>
  );
}

function Body({ outcome }: { outcome: ScoreOutcome }) {
  if (outcome.kind === 'offline' || outcome.kind === 'refused') {
    return (
      <Card tone="inset" padding="md" data-testid="league-notice">
        <p className="m-0 text-md text-chalk">{outcome.message}</p>
      </Card>
    );
  }
  if (outcome.kind === 'invalid') {
    return (
      <Card tone="inset" padding="md" data-testid="league-problems">
        <p className="m-0 text-md font-medium text-wicket">
          The entry cannot be scored as written.
        </p>
        <ul className="m-0 mt-2 list-none space-y-1 p-0 text-sm text-chalk">
          {outcome.problems.map((p, i) => (
            <li key={i}>
              <span className="font-mono text-chalk-dim">line {p.line}</span> {p.message}
            </li>
          ))}
        </ul>
      </Card>
    );
  }
  const { result, rank } = outcome.data;
  if (!result.ok) {
    return (
      <Card tone="inset" padding="md" data-testid="league-no-score">
        <p className="m-0 text-md font-medium text-wicket">{failureHeadline(result.reason)}</p>
        <pre className="m-0 mt-2 whitespace-pre-wrap font-mono text-sm text-chalk">
          {result.message}
        </pre>
      </Card>
    );
  }
  return (
    <Card tone="raised" padding="md" focal={result.underPar > 0} data-testid="league-score">
      <div className="flex flex-wrap items-center gap-2">
        <Pill tone={result.underPar > 0 ? 'turf' : result.underPar === 0 ? 'neutral' : 'wicket'}>
          {underParLabel(result.underPar)}
        </Pill>
        <span className="text-sm text-chalk-dim">Par is {result.par}.</span>
      </div>
      <div className="mt-3 flex flex-wrap gap-x-10 gap-y-3">
        <Scoreline label="Commands" value={result.commands} size="lg" tone="flood" />
        <Scoreline label="Bytes" value={result.bytes} hint="the checked keys use" />
        <Scoreline label="Characters" value={result.chars} hint="of command text" />
      </div>
      {rank ? (
        <p className="m-0 mt-3 text-md text-chalk" data-testid="league-rank">
          {rankSentence(rank)}
        </p>
      ) : null}
      <p className="m-0 mt-2 text-sm text-chalk-dim">
        All {result.checks.length} checks passed. Lowest commands wins; ties go to fewer bytes, then
        fewer characters.
      </p>
    </Card>
  );
}
