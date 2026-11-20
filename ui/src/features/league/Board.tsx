import { isScored, underParLabel } from './logic';
import type { LeagueHole } from './types';

/** The committed entries of one hole, best first, with the house entry marked. */
export function Board({ hole, scored }: { hole: LeagueHole; scored: boolean }) {
  if (hole.entries.length === 0) {
    return <p className="m-0 text-sm text-chalk-dim">No entries yet. Yours could be the first.</p>;
  }
  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-sm" data-testid="league-board">
        <caption className="sr-only">Committed entries for {hole.title}, best first</caption>
        <thead>
          <tr className="label-caps text-left text-xs text-chalk-dim">
            <th scope="col" className="py-1.5 pr-3 font-medium">
              Rank
            </th>
            <th scope="col" className="py-1.5 pr-3 font-medium">
              Handle
            </th>
            <th scope="col" className="py-1.5 pr-3 text-right font-medium">
              Commands
            </th>
            {scored ? (
              <>
                <th scope="col" className="py-1.5 pr-3 text-right font-medium">
                  Bytes
                </th>
                <th scope="col" className="py-1.5 pr-3 text-right font-medium">
                  Characters
                </th>
                <th scope="col" className="py-1.5 text-right font-medium">
                  Against par
                </th>
              </>
            ) : null}
          </tr>
        </thead>
        <tbody>
          {hole.entries.map((e) => (
            <tr key={e.handle} className="border-t border-night-600/60 text-chalk">
              <td className="tabular py-1.5 pr-3">{isScored(e) ? e.rank : '-'}</td>
              <td className="py-1.5 pr-3 font-mono">
                {e.handle}
                {e.handle === 'par-house' ? (
                  <span className="ml-2 text-xs text-chalk-dim">the house</span>
                ) : null}
              </td>
              <td className="tabular py-1.5 pr-3 text-right">{e.commands}</td>
              {isScored(e) ? (
                <>
                  <td className="tabular py-1.5 pr-3 text-right">{e.bytes}</td>
                  <td className="tabular py-1.5 pr-3 text-right">{e.chars}</td>
                  <td className="py-1.5 text-right text-chalk-dim">{underParLabel(e.underPar)}</td>
                </>
              ) : scored ? (
                <td colSpan={3} />
              ) : null}
            </tr>
          ))}
        </tbody>
      </table>
      {hole.failed.length > 0 ? (
        <ul className="m-0 mt-2 list-none p-0 text-sm text-wicket" data-testid="league-failed">
          {hole.failed.map((f) => (
            <li key={f.handle}>
              {f.handle} does not pass this hole right now: {f.message.split('\n')[0]}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
