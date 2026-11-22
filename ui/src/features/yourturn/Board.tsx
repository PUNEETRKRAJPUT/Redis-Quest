'use client';

import { PenLine, RefreshCw, ServerCrash } from 'lucide-react';
import { useId, useMemo, useState } from 'react';
import { Button, EmptyState, Pill, Skeleton, Switch } from '@/design';
import { QuestLink } from '@/shell/QuestLink';
import { filterGroups, studioLink, type BoardData, type Coverage } from './logic';

/**
 * The wanted-commands board: the running server's own commands, grouped by the server's own group, untaught first,
 * the server's own summary beside each name. Nothing here is typed in; with Redis down it says so and shows nothing.
 */
export function Board({
  coverage,
  picked,
  onPick,
  onRetry,
}: {
  /** null while the first answer is on its way. */
  coverage: Coverage | null;
  picked: string | null;
  onPick: (command: string) => void;
  onRetry: () => void;
}) {
  const [query, setQuery] = useState('');
  const [untaughtOnly, setUntaughtOnly] = useState(true);
  const searchId = useId();

  if (coverage === null) {
    return (
      <div data-testid="board-loading" aria-busy="true">
        <Skeleton lines={6} label="Reading the command list" />
      </div>
    );
  }
  if (!coverage.available) {
    return (
      <div data-testid="board-unavailable">
        <EmptyState
          icon={<ServerCrash size={22} aria-hidden="true" />}
          title="No command board right now"
          action={
            <Button
              variant="ghost"
              leading={<RefreshCw size={14} aria-hidden="true" />}
              onClick={onRetry}
            >
              Try again
            </Button>
          }
        >
          {coverage.reason}
        </EmptyState>
      </div>
    );
  }
  return (
    <BoardBody
      data={coverage}
      picked={picked}
      onPick={onPick}
      query={query}
      setQuery={setQuery}
      untaughtOnly={untaughtOnly}
      setUntaughtOnly={setUntaughtOnly}
      searchId={searchId}
    />
  );
}

function BoardBody({
  data,
  picked,
  onPick,
  query,
  setQuery,
  untaughtOnly,
  setUntaughtOnly,
  searchId,
}: {
  data: BoardData;
  picked: string | null;
  onPick: (command: string) => void;
  query: string;
  setQuery: (q: string) => void;
  untaughtOnly: boolean;
  setUntaughtOnly: (v: boolean) => void;
  searchId: string;
}) {
  const groups = useMemo(
    () => filterGroups(data.groups, { query, untaughtOnly }),
    [data.groups, query, untaughtOnly],
  );
  const shown = groups.reduce((n, g) => n + g.commands.length, 0);
  return (
    <div data-testid="board">
      <p data-testid="board-counts" className="m-0 text-md text-chalk-dim">
        <strong className="tabular text-chalk">{data.taught}</strong> of{' '}
        <strong className="tabular text-chalk">{data.commands}</strong> commands are taught by a
        level. <strong className="tabular text-chalk">{data.untaught}</strong> are still waiting for
        someone to write one.
      </p>
      <p className="m-0 mt-1 text-sm text-chalk-dim">
        This Redis lists <span className="tabular">{data.listed}</span> names:{' '}
        <span className="tabular">{data.skipped.subcommands}</span> are subcommands (they count
        under their parent) and <span className="tabular">{data.skipped.modules}</span> are module
        commands the game leaves out. Taught means a reference solution or a check of one of the{' '}
        <span className="tabular">{data.levelsRead}</span> campaign and community levels uses it.
      </p>
      <div className="mt-4 flex flex-wrap items-center gap-4">
        <label htmlFor={searchId} className="sr-only">
          Filter commands
        </label>
        <input
          id={searchId}
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Filter by name, summary or group"
          className="h-9 min-w-64 flex-1 rounded-md border border-night-600 bg-night-950 px-3 text-md text-chalk placeholder:text-chalk-faint"
        />
        <Switch checked={untaughtOnly} onCheckedChange={setUntaughtOnly} label="Only untaught" />
      </div>
      <p className="m-0 mt-3 text-sm text-chalk-dim" role="status" aria-live="polite">
        Showing {shown} {shown === 1 ? 'command' : 'commands'}.
      </p>
      {groups.length === 0 ? (
        <p className="mt-4 text-md text-chalk-dim">
          Nothing matches. Clear the filter or switch off &ldquo;Only untaught&rdquo;.
        </p>
      ) : (
        <div className="mt-2 flex flex-col gap-6">
          {groups.map((g) => {
            const full = data.groups.find((x) => x.group === g.group) ?? g;
            return (
              <section key={g.group} aria-labelledby={`group-${g.group}`} data-testid="board-group">
                <h3
                  id={`group-${g.group}`}
                  className="m-0 flex items-baseline gap-3 font-display text-lg font-semibold uppercase tracking-wide text-chalk"
                >
                  {g.group}
                  <span className="tabular text-sm font-normal normal-case text-chalk-dim">
                    {full.taught} of {full.total} taught
                  </span>
                </h3>
                <ul className="m-0 mt-2 list-none divide-y divide-night-600/60 p-0">
                  {g.commands.map((c) => (
                    <li
                      key={c.name}
                      data-testid={`board-row-${c.name}`}
                      className="flex flex-wrap items-center gap-x-4 gap-y-1 py-2"
                    >
                      <code className="w-40 shrink-0 font-mono text-md text-chalk">
                        {c.name.toUpperCase()}
                      </code>
                      <span className="min-w-0 flex-1 basis-64 text-sm text-chalk-dim">
                        {c.summary || 'The server gave no summary for this command.'}
                      </span>
                      {c.taught ? (
                        <Pill
                          tone="turf"
                          size="sm"
                          title={c.usedBy.map((u) => u.levelId).join(', ')}
                        >
                          Taught
                        </Pill>
                      ) : (
                        <QuestLink
                          to={studioLink(c.name)}
                          onClick={() => onPick(c.name)}
                          data-testid={`write-level-${c.name}`}
                          aria-label={`Write a level about ${c.name.toUpperCase()}`}
                          className="inline-flex h-8 items-center gap-1.5 rounded-md border border-flood-500/50 px-3 text-sm font-medium text-flood-400 no-underline hover:bg-flood-500/10"
                        >
                          <PenLine size={14} aria-hidden="true" />
                          {picked === c.name
                            ? 'Picked: open the studio'
                            : 'Write a level about this'}
                        </QuestLink>
                      )}
                    </li>
                  ))}
                </ul>
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
}
