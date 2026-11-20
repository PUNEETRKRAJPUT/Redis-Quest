'use client';

import { Flag, GitPullRequest, ListChecks, Play, Trophy } from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';
import { Button, Card, EmptyState, Panel, Pill, Skeleton, celebrate, play } from '@/design';
import { ToolPage } from '@/career/ToolPage';
import { Markdown } from '@/markdown';
import { fetchLeague, scoreAttempt } from './api';
import { Board } from './Board';
import { commandLines, draftKey, holeById } from './logic';
import { Scorecard } from './Scorecard';
import { Submit } from './Submit';
import type { LeagueResponse, ScoreOutcome } from './types';

function readDraft(holeId: string): string {
  try {
    return localStorage.getItem(draftKey(holeId)) ?? '';
  } catch {
    return '';
  }
}

function saveDraft(holeId: string, text: string): void {
  try {
    localStorage.setItem(draftKey(holeId), text);
  } catch {
    /* storage can be blocked; the draft just is not kept */
  }
}

/** /league: pick a hole, write an entry, score it, see where it would rank, and how to submit it as a pull request. */
export function League() {
  const [data, setData] = useState<LeagueResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  const [pickedId, setPickedId] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<ScoreOutcome | null>(null);

  useEffect(() => {
    let live = true;
    fetchLeague().then(
      (d) => live && setData(d),
      (e: unknown) => live && setError(e instanceof Error ? e.message : String(e)),
    );
    return () => {
      live = false;
    };
  }, [tick]);

  const frame = (children: ReactNode) => (
    <ToolPage
      eyebrow="Beyond the season"
      title="Economy League"
      blurb="Code golf for Redis. A hole is a small task, an entry is a list of commands, and the fewest commands wins. Ties go to fewer bytes, then fewer characters. Speed is never ranked."
      testId="league-screen"
    >
      {children}
    </ToolPage>
  );

  if (error) {
    return frame(
      <EmptyState
        title="The league could not load"
        action={
          <Button
            variant="ghost"
            onClick={() => {
              setError(null);
              setTick((t) => t + 1);
            }}
          >
            Try again
          </Button>
        }
      >
        {error}
      </EmptyState>,
    );
  }
  if (!data) return frame(<Skeleton lines={4} label="Loading the holes" />);
  if (!data.available || data.holes.length === 0) {
    return frame(
      <EmptyState title="No holes yet">
        This stack does not have the golf folder. The holes live in golf/holes in the repository.
      </EmptyState>,
    );
  }

  const hole = holeById(data.holes, pickedId);
  if (!hole) return frame(<Skeleton lines={4} label="Loading the holes" />);
  const text = drafts[hole.id] ?? readDraft(hole.id);

  const pick = (id: string) => {
    setPickedId(id);
    setOutcome(null);
  };
  const edit = (value: string) => {
    setDrafts((d) => ({ ...d, [hole.id]: value }));
    saveDraft(hole.id, value);
  };
  const score = async () => {
    if (busy) return;
    setBusy(true);
    const o = await scoreAttempt(hole.id, text);
    setOutcome(o);
    setBusy(false);
    if (o.kind === 'scored' && o.data.result.ok) {
      if (o.data.result.underPar > 0) celebrate();
      else play('tock');
    } else {
      play('out');
    }
  };

  return frame(
    <>
      {data.problems.length > 0 ? (
        <Card tone="inset" padding="md" data-testid="league-load-problems">
          <p className="m-0 text-md font-medium text-wicket">
            Some files in golf/ did not load, so some holes or entries may be missing:
          </p>
          <ul className="m-0 mt-2 list-none p-0 font-mono text-sm text-chalk">
            {data.problems.map((p) => (
              <li key={p}>{p}</li>
            ))}
          </ul>
        </Card>
      ) : null}
      {!data.scored && data.unscored ? (
        <Card tone="inset" padding="md" data-testid="league-unscored">
          <Pill tone="wicket">No scores right now</Pill>
          <p className="m-0 mt-2 text-md text-chalk">{data.unscored}</p>
        </Card>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-[260px_minmax(0,1fr)]">
        <nav aria-label="Holes" data-testid="league-holes">
          <ul className="m-0 flex list-none flex-col gap-2 p-0">
            {data.holes.map((h) => {
              const current = h.id === hole.id;
              return (
                <li key={h.id}>
                  <button
                    type="button"
                    aria-current={current ? 'true' : undefined}
                    data-testid={`league-hole-${h.id}`}
                    onClick={() => pick(h.id)}
                    className={`block w-full cursor-pointer rounded-lg border p-3 text-left text-chalk transition-colors duration-fast ${
                      current
                        ? 'border-flood-500 bg-night-800'
                        : 'border-night-600 bg-night-900 hover:border-flood-500'
                    }`}
                  >
                    <span className="block font-display text-lg font-semibold uppercase tracking-wide">
                      {h.title}
                    </span>
                    <span className="mt-0.5 block text-sm text-chalk-dim">
                      Par {h.par}, {h.entries.length} {h.entries.length === 1 ? 'entry' : 'entries'}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </nav>

        <div className="flex min-w-0 flex-col gap-6" data-testid="league-hole">
          <Panel
            as="h2"
            title={hole.title}
            eyebrow={`Hole ${hole.id.slice(0, 2)}`}
            icon={<Flag size={16} aria-hidden="true" />}
            actions={<Pill tone="flood">Par {hole.par}</Pill>}
          >
            <Markdown source={hole.task} />
            {hole.setup.length > 0 ? (
              <details className="mt-3" data-testid="league-setup">
                <summary className="cursor-pointer text-sm text-chalk-dim">
                  What is already in the database ({hole.setup.length} commands)
                </summary>
                <pre className="m-0 mt-2 overflow-x-auto rounded-md bg-night-950/80 p-3 font-mono text-sm text-chalk">
                  {hole.setup.join('\n')}
                </pre>
              </details>
            ) : null}
          </Panel>

          <Panel
            as="h2"
            title="What must be true afterwards"
            icon={<ListChecks size={16} aria-hidden="true" />}
          >
            <ul
              className="m-0 list-none space-y-1 p-0 text-sm text-chalk"
              data-testid="league-checks"
            >
              {hole.checks.map((c, i) => (
                <li key={i}>
                  <code className="font-mono text-flood-400">{c.cmd}</code>
                  <span className="text-chalk-dim"> must answer </span>
                  <span className="font-mono">{c.expected}</span>
                </li>
              ))}
            </ul>
          </Panel>

          <Panel
            as="h2"
            title="Your entry"
            icon={<Play size={16} aria-hidden="true" />}
            footer={
              <div className="flex flex-wrap items-center gap-3">
                <Button
                  variant="primary"
                  leading={<Play size={14} aria-hidden="true" />}
                  loading={busy}
                  loadingText="Scoring"
                  disabled={commandLines(text) === 0}
                  shortcut="⌘↵"
                  onClick={() => void score()}
                  data-testid="league-score-it"
                >
                  Score it
                </Button>
                <span className="text-sm text-chalk-dim" data-testid="league-count">
                  {commandLines(text)} command {commandLines(text) === 1 ? 'line' : 'lines'}, par{' '}
                  {hole.par}
                </span>
              </div>
            }
          >
            <label htmlFor="league-entry" className="label-caps text-xs text-chalk-dim">
              One Redis command per line. A line starting with # is a comment.
            </label>
            <textarea
              id="league-entry"
              data-testid="league-entry"
              value={text}
              rows={8}
              spellCheck={false}
              autoCapitalize="off"
              autoCorrect="off"
              placeholder={'SET some:key "a value"'}
              onChange={(e) => edit(e.target.value)}
              onKeyDown={(e) => {
                if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
                  e.preventDefault();
                  void score();
                }
              }}
              className="mt-2 w-full resize-y rounded-md border border-night-600 bg-night-950 p-3 font-mono text-md text-chalk placeholder:text-chalk-faint"
            />
            <p className="m-0 mt-2 text-sm text-chalk-dim">
              Scored on your own Redis in database {data.db}, which is emptied each time. Your game
              data in database 0 is never touched.
            </p>
            <div className="mt-4">
              <Scorecard outcome={outcome} />
            </div>
          </Panel>

          <Panel as="h2" title="Committed entries" icon={<Trophy size={16} aria-hidden="true" />}>
            <Board hole={hole} scored={data.scored} />
          </Panel>

          <Panel
            as="h2"
            title="Submit it as a pull request"
            icon={<GitPullRequest size={16} aria-hidden="true" />}
          >
            <Submit holeId={hole.id} entry={text} />
          </Panel>
        </div>
      </div>
    </>,
  );
}
