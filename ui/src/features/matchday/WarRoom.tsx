import { Octagon, Radio } from 'lucide-react';
import { Button, Card, Panel, Pill, Scoreline } from '@/design';
import { boardRows, PHASE_LABEL, type LiveFigures } from './model';
import { Scoreboard } from './Scoreboard';
import type { MatchStatus, PlayedCard } from './types';

const SOURCE_LABEL = {
  digest: 'In the Redis docs digest',
  measured: 'Measured on this stack',
  simulation: 'A simulation',
} as const;

export function CardView({ card }: { card: PlayedCard }) {
  return (
    <Card tone="raised" focal padding="md" data-testid="matchday-card">
      <div className="label-caps text-xs text-flood-400">Incident</div>
      <h3 className="m-0 mt-1 font-display text-xl font-semibold uppercase tracking-wide text-chalk">
        {card.title}
      </h3>
      <p className="m-0 mt-2 whitespace-pre-line text-md text-chalk">{card.sees}</p>
      <div className="mt-3 text-sm text-chalk-dim">
        <p className="m-0 whitespace-pre-line">{card.causeSummary}</p>
        {card.applied.length > 0 ? (
          <ul className="m-0 mt-2 list-disc pl-5" data-testid="matchday-card-applied">
            {card.applied.map((a) => (
              <li key={a}>{a}</li>
            ))}
          </ul>
        ) : null}
        {card.skipped.length > 0 ? (
          <ul className="m-0 mt-2 list-disc pl-5 text-chalk" data-testid="matchday-card-skipped">
            {card.skipped.map((a) => (
              <li key={a}>{a}</li>
            ))}
          </ul>
        ) : null}
        <p className="m-0 mt-2 whitespace-pre-line">{card.ends}</p>
      </div>
      {card.facts.length > 0 ? (
        <ul className="m-0 mt-3 flex list-none flex-col gap-2 p-0">
          {card.facts.map((f) => (
            <li key={f.text} className="flex flex-wrap items-start gap-2 text-sm text-chalk-dim">
              <Pill tone={f.source === 'digest' ? 'sky' : 'neutral'} size="sm">
                {SOURCE_LABEL[f.source]}
              </Pill>
              <span className="min-w-0 flex-1">{f.text}</span>
            </li>
          ))}
        </ul>
      ) : null}
    </Card>
  );
}

export interface WarRoomProps {
  status: MatchStatus;
  figures: LiveFigures;
  secondsLeft: number | null;
  stopping: boolean;
  onStop: () => void;
}

/** The match in progress: the scoreboard, the clock, the current incident and what the app is serving right now. */
export function WarRoom({ status, figures, secondsLeft, stopping, onStop }: WarRoomProps) {
  const rows = boardRows(status);
  const over = status.currentOver;
  const phase = status.phase ? PHASE_LABEL[status.phase] : 'Starting';
  return (
    <div className="flex flex-col gap-6" data-testid="matchday-warroom">
      <Card focal padding="lg">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div aria-live="polite">
            <div className="label-caps flex items-center gap-2 text-xs text-flood-400">
              <Radio size={14} aria-hidden="true" className="ds-still animate-live" />
              Seed {status.seed}
              {status.date ? ` (${status.date})` : ''}
            </div>
            <h2 className="m-0 mt-1 font-display text-2xl font-bold uppercase tracking-wide text-chalk">
              {`Over ${over ?? '-'} of ${status.overs.length}`}
            </h2>
            <p className="m-0 mt-1 text-sm text-chalk-dim" data-testid="matchday-phase">
              {phase}
              {secondsLeft !== null && status.phase === 'bowling' ? `, ${secondsLeft} s left` : ''}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-8">
            <Scoreline
              label="Score"
              value={`${status.runs}/${status.wickets}`}
              tone="flood"
              size="lg"
              hint={`${Math.max(0, status.wicketsInHand - status.wickets)} wickets in hand`}
            />
            <Button
              variant="danger"
              leading={<Octagon size={16} aria-hidden="true" />}
              loading={stopping}
              loadingText="Stopping"
              onClick={onStop}
              data-testid="matchday-stop"
            >
              Stop the match
            </Button>
          </div>
        </div>
        <p className="m-0 mt-3 text-xs text-chalk-dim">
          Stopping puts everything an incident changed back and scores nothing for the over in play.
        </p>
      </Card>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,360px)]">
        <Panel title="Scoreboard">
          <Scoreboard rows={rows} />
        </Panel>
        <div className="flex flex-col gap-6">
          <Panel title="What the app is serving" eyebrow="From the metrics ticks">
            <div className="flex flex-wrap gap-8" data-testid="matchday-live">
              <Scoreline
                label="Requests per second"
                value={figures.rps === null ? '-' : figures.rps}
                size="md"
              />
              <Scoreline
                label="99th percentile"
                value={figures.p99Ms === null ? '-' : figures.p99Ms}
                unit={figures.p99Ms === null ? undefined : 'ms'}
                size="md"
              />
            </div>
          </Panel>
          {status.card ? <CardView card={status.card} /> : null}
        </div>
      </div>
    </div>
  );
}
