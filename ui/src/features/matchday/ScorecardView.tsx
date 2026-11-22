import { ClipboardCopy } from 'lucide-react';
import { Button, Card, Panel, Pill, Scoreline } from '@/design';
import { ENDED_LABEL, boardRows } from './model';
import { Scoreboard } from './Scoreboard';
import type { MatchStatus } from './types';

export interface ScorecardViewProps {
  status: MatchStatus;
  machineNote: string;
  copied: boolean;
  onCopy: () => void;
  onBack: () => void;
}

/** The final scorecard in cricket form, with the same text ready to copy. */
export function ScorecardView({ status, machineNote, copied, onCopy, onBack }: ScorecardViewProps) {
  const r = status.result;
  if (!r) return null;
  const tone = r.endedBy === 'complete' ? 'turf' : r.endedBy === 'all_out' ? 'wicket' : 'neutral';
  return (
    <div className="flex flex-col gap-6" data-testid="matchday-scorecard">
      <Card focal padding="lg">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <div className="label-caps text-xs text-flood-400">
              Scorecard, seed {r.seed}
              {r.date ? ` (${r.date})` : ''}
            </div>
            <h2 className="m-0 mt-1 flex flex-wrap items-center gap-3 font-display text-2xl font-bold uppercase tracking-wide text-chalk">
              <span className="tabular" data-testid="matchday-total">
                {`${r.runs}/${r.wickets}`}
              </span>
              <span className="text-chalk-dim">
                {`after ${r.oversBowled} over${r.oversBowled === 1 ? '' : 's'}`}
              </span>
              <Pill tone={tone} variant="status">
                {ENDED_LABEL[r.endedBy]}
              </Pill>
            </h2>
            {r.note ? <p className="m-0 mt-2 text-sm text-chalk-dim">{r.note}</p> : null}
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <Button
              variant="primary"
              leading={<ClipboardCopy size={16} aria-hidden="true" />}
              onClick={onCopy}
              data-testid="matchday-copy"
            >
              {copied ? 'Copied' : 'Copy as text'}
            </Button>
            <Button variant="ghost" onClick={onBack} data-testid="matchday-back">
              Back to the fixture
            </Button>
          </div>
        </div>
      </Card>

      <Panel title="Over by over">
        <Scoreboard rows={boardRows(status)} />
        {r.overs.some((o) => o.wicket) ? (
          <ul className="m-0 mt-4 flex list-none flex-col gap-1 p-0 text-sm text-chalk-dim">
            {r.overs
              .filter((o) => o.wicket)
              .map((o) => (
                <li key={o.over}>
                  <span className="font-semibold text-wicket">Over {o.over}, wicket:</span>{' '}
                  {o.why.join('; ')}
                </li>
              ))}
          </ul>
        ) : null}
        <div className="mt-4 flex flex-wrap gap-8">
          <Scoreline label="Runs" value={r.runs} size="sm" />
          <Scoreline label="Wickets" value={r.wickets} size="sm" />
        </div>
        <p className="m-0 mt-4 text-xs text-chalk-dim">{machineNote}</p>
      </Panel>

      <details className="rounded-md border border-night-600 bg-night-900 p-3">
        <summary className="cursor-pointer text-sm text-chalk-dim">
          The scorecard as plain text
        </summary>
        <pre
          className="m-0 mt-3 overflow-x-auto whitespace-pre font-mono text-xs text-chalk"
          data-testid="matchday-text"
        >
          {r.text}
        </pre>
      </details>
    </div>
  );
}
