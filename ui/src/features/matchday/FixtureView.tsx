import { Dice5, Play, Trophy } from 'lucide-react';
import { Button, Card, Panel, Pill } from '@/design';
import { ENDED_LABEL } from './model';
import type { MatchdayOverview, MatchResult } from './types';

function ResultLine({ r }: { r: MatchResult }) {
  return (
    <li className="flex flex-wrap items-baseline gap-x-3 text-sm text-chalk">
      <span className="tabular font-mono text-md font-semibold">
        {r.runs}/{r.wickets}
      </span>
      <span className="text-chalk-dim">
        seed {r.seed}
        {r.date ? ` (${r.date})` : ''}, {ENDED_LABEL[r.endedBy].toLowerCase()}
      </span>
    </li>
  );
}

export interface FixtureViewProps {
  overview: MatchdayOverview;
  /** The seed shown: today's, or the one the player picked. */
  seedLabel: 'today' | 'other';
  seedText: string;
  seedProblem: string | null;
  starting: boolean;
  error: string | null;
  hasLastMatch: boolean;
  onSeedText: (v: string) => void;
  onRandom: () => void;
  onUseSeed: () => void;
  onUseToday: () => void;
  onStart: () => void;
  onShowLast: () => void;
}

/** The fixture card: this match's six overs, the rules, the best so far, and the two ways to start. */
export function FixtureView(p: FixtureViewProps) {
  const { overview: o } = p;
  const f = o.fixture;
  const first = f.overs[0];
  const incidents = f.overs.filter((x) => x.incident).length;
  const seedHeading = p.seedLabel === 'today' ? "Today's match" : 'Another seed';
  return (
    <div className="flex flex-col gap-6" data-testid="matchday-fixture">
      <Card focal padding="lg">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="label-caps text-xs text-flood-400">{seedHeading}</div>
            <h2 className="m-0 mt-1 font-display text-2xl font-bold uppercase tracking-wide text-chalk">
              {f.date ? f.date : `Seed ${f.seed}`}
            </h2>
            <p className="m-0 mt-1 text-sm text-chalk-dim">
              Seed <span className="tabular font-mono text-chalk">{f.seed}</span>
              {p.seedLabel === 'today'
                ? ': the date is the seed, so everyone plays this same match today.'
                : ': the same seed always gives the same match.'}
            </p>
          </div>
          <Button
            variant="primary"
            size="lg"
            leading={<Play size={16} aria-hidden="true" />}
            loading={p.starting}
            loadingText="Starting"
            disabled={!o.canStart.ok}
            onClick={p.onStart}
            data-testid="matchday-start"
          >
            Start the match
          </Button>
        </div>
        {!o.canStart.ok && o.canStart.reason ? (
          <p className="m-0 mt-3 text-sm text-chalk-dim" data-testid="matchday-cannot-start">
            {`Not now: ${o.canStart.reason}.`}
          </p>
        ) : null}
        {p.error ? (
          <p
            className="m-0 mt-3 text-sm font-medium text-wicket"
            role="alert"
            data-testid="matchday-error"
          >
            {p.error}
          </p>
        ) : null}
        {o.deckErrors.length > 0 ? (
          <p className="m-0 mt-3 text-sm text-wicket" role="alert">
            The incident deck has {o.deckErrors.length} problem
            {o.deckErrors.length === 1 ? '' : 's'}: {o.deckErrors[0]}
          </p>
        ) : null}
      </Card>

      <Panel
        title="The six overs"
        eyebrow={`${incidents} incident${incidents === 1 ? '' : 's'} on the card`}
      >
        <ol className="m-0 flex list-none flex-col gap-2 p-0" data-testid="matchday-overs">
          {f.overs.map((x) => (
            <li
              key={x.over}
              className="flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-night-600/60 pt-2 first:border-t-0 first:pt-0"
            >
              <span className="w-6 font-display text-lg font-semibold text-chalk">{x.over}</span>
              <span className="font-mono text-xs text-chalk">{x.scenario}</span>
              <span className="text-xs text-chalk-dim">
                {x.connections} connections, {x.durationSec} s
              </span>
              {x.incident ? (
                <Pill tone="flood" size="sm">
                  Incident before this over
                </Pill>
              ) : null}
            </li>
          ))}
        </ol>
        <p className="m-0 mt-4 text-sm text-chalk-dim">
          An over scores up to 36 runs, from the share of requests your build answers without an
          error. It loses a wicket when more than{' '}
          {first ? `${(first.errorBudget * 100).toFixed(0)}%` : '1%'} of requests fail, or the 99th
          percentile passes {first ? first.p99BudgetMs : 400} ms (more room in an over with an
          incident). Lose {f.wicketsInHand} wickets and you are all out. Which incident comes stays
          hidden until it is played.
        </p>
      </Panel>

      <Panel title="Another seed" icon={<Dice5 size={16} aria-hidden="true" />}>
        <div className="flex flex-wrap items-end gap-3">
          <label className="flex flex-col gap-1 text-sm text-chalk-dim">
            Seed (1 to 2147483647)
            <input
              type="text"
              inputMode="numeric"
              value={p.seedText}
              onChange={(e) => p.onSeedText(e.target.value)}
              aria-invalid={p.seedProblem ? true : undefined}
              aria-describedby={p.seedProblem ? 'matchday-seed-problem' : undefined}
              data-testid="matchday-seed-input"
              className="h-9 w-48 rounded-sm border border-night-600 bg-night-950 px-3 font-mono text-md text-chalk"
            />
          </label>
          <Button variant="ghost" onClick={p.onRandom} data-testid="matchday-random">
            Random seed
          </Button>
          <Button variant="ghost" onClick={p.onUseSeed} data-testid="matchday-use-seed">
            Show this match
          </Button>
          {p.seedLabel === 'other' ? (
            <Button variant="quiet" onClick={p.onUseToday}>
              Back to today
            </Button>
          ) : null}
        </div>
        {p.seedProblem ? (
          <p id="matchday-seed-problem" className="m-0 mt-2 text-sm text-wicket" role="alert">
            {p.seedProblem}
          </p>
        ) : null}
      </Panel>

      <Panel
        title="Best on this machine"
        icon={<Trophy size={16} aria-hidden="true" />}
        actions={
          p.hasLastMatch ? (
            <Button variant="quiet" size="sm" onClick={p.onShowLast}>
              Last scorecard
            </Button>
          ) : undefined
        }
      >
        {o.bestForSeed ? (
          <p className="m-0 mb-3 text-sm text-chalk" data-testid="matchday-best-seed">
            Your best on this seed:{' '}
            <span className="tabular font-mono font-semibold">
              {o.bestForSeed.runs}/{o.bestForSeed.wickets}
            </span>
          </p>
        ) : (
          <p className="m-0 mb-3 text-sm text-chalk-dim">No finished match on this seed yet.</p>
        )}
        {o.results.best.length > 0 ? (
          <ul className="m-0 flex list-none flex-col gap-1.5 p-0" data-testid="matchday-best">
            {o.results.best.map((r) => (
              <ResultLine key={`${r.seed}-${r.finishedAt}`} r={r} />
            ))}
          </ul>
        ) : null}
        <p className="m-0 mt-4 text-xs text-chalk-dim" data-testid="matchday-machine-note">
          {o.machineNote}
        </p>
      </Panel>
    </div>
  );
}
