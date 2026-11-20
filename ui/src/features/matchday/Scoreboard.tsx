import { clsx } from 'clsx';
import { Pill } from '@/design';
import { formatPercent, type BoardRow } from './model';

const STATE_LABEL = {
  done: 'Bowled',
  current: 'In play',
  upcoming: 'To come',
  not_bowled: 'Not bowled',
} as const;

/** The overs as a scoreboard: one row each, the incident named once it has been played, runs and a wicket mark. */
export function Scoreboard({ rows }: { rows: BoardRow[] }) {
  return (
    <div className="overflow-x-auto" data-testid="matchday-scoreboard">
      <table className="w-full min-w-[640px] border-collapse text-sm">
        <caption className="sr-only">The six overs of the match and how each went</caption>
        <thead>
          <tr className="label-caps text-left text-xs text-chalk-dim">
            <th scope="col" className="px-3 py-2 font-medium">
              Over
            </th>
            <th scope="col" className="px-3 py-2 font-medium">
              Traffic
            </th>
            <th scope="col" className="px-3 py-2 font-medium">
              Incident
            </th>
            <th scope="col" className="px-3 py-2 text-right font-medium">
              Runs
            </th>
            <th scope="col" className="px-3 py-2 text-center font-medium">
              Wicket
            </th>
            <th scope="col" className="px-3 py-2 text-right font-medium">
              p99
            </th>
            <th scope="col" className="px-3 py-2 text-right font-medium">
              Errors
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr
              key={r.over}
              data-testid={`over-row-${r.over}`}
              data-state={r.state}
              aria-current={r.state === 'current' ? 'step' : undefined}
              className={clsx(
                'border-t border-night-600/70',
                r.state === 'current' && 'bg-flood-500/10',
                r.state === 'not_bowled' && 'text-chalk-faint',
              )}
            >
              <th scope="row" className="px-3 py-2.5 text-left font-display text-lg font-semibold">
                {r.over}
              </th>
              <td className="px-3 py-2.5">
                <span className="font-mono text-xs text-chalk">{r.scenario}</span>
                {r.state !== 'done' ? (
                  <span className="ml-2 text-xs text-chalk-dim">{STATE_LABEL[r.state]}</span>
                ) : null}
              </td>
              <td className="px-3 py-2.5">
                {r.cardTitle ? (
                  <span className="text-chalk">{r.cardTitle}</span>
                ) : r.incident ? (
                  <Pill tone="flood" size="sm">
                    {r.state === 'done' || r.state === 'current' ? 'Incident' : 'Incident to come'}
                  </Pill>
                ) : (
                  <span className="text-chalk-faint">None</span>
                )}
              </td>
              <td className="tabular px-3 py-2.5 text-right font-mono text-md text-chalk">
                {r.score ? r.score.runs : '-'}
              </td>
              <td className="px-3 py-2.5 text-center">
                {r.score?.wicket ? (
                  <Pill tone="wicket" size="sm">
                    W
                  </Pill>
                ) : (
                  <span className="text-chalk-faint">{r.score ? 'Safe' : '-'}</span>
                )}
              </td>
              <td
                className={clsx(
                  'tabular px-3 py-2.5 text-right font-mono',
                  r.score && r.score.p99Ms > r.p99BudgetMs ? 'text-wicket' : 'text-chalk',
                )}
              >
                {r.score ? `${Math.round(r.score.p99Ms)} ms` : `${r.p99BudgetMs} ms max`}
              </td>
              <td
                className={clsx(
                  'tabular px-3 py-2.5 text-right font-mono',
                  r.score && r.score.errorShare > r.errorBudget ? 'text-wicket' : 'text-chalk',
                )}
              >
                {r.score
                  ? formatPercent(r.score.errorShare)
                  : `${formatPercent(r.errorBudget)} max`}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
