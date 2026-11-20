'use client';
import { PencilRuler, TriangleAlert, Users } from 'lucide-react';
import { useEffect, useState } from 'react';
import { ApiError } from '../../api';
import { ToolPage } from '../../career/ToolPage';
import { Card, EmptyState, Panel, Pill, Skeleton } from '../../design';
import { QuestLink } from '../../shell/QuestLink';
import { communityApi } from './client';
import { byline, type CommunityList, type CommunityPack, type CommunityStatus } from './types';

const STATUS_TONE = { new: 'neutral', in_progress: 'flood', passed: 'turf' } as const;
const STATUS_LABEL: Record<CommunityStatus, string> = {
  new: 'New',
  in_progress: 'In progress',
  passed: 'Passed',
};
const MODE_LABEL = { cli: 'Terminal', decision: 'Decision' } as const;

function PackPanel({ pack }: { pack: CommunityPack }) {
  return (
    <Panel
      title={pack.title ?? pack.id}
      eyebrow={`Pack ${pack.id}`}
      icon={<Users size={16} aria-hidden />}
      tone="raised"
      data-testid={`pack-${pack.id}`}
      actions={
        pack.errors.length > 0 ? (
          <Pill tone="wicket" size="sm" icon={<TriangleAlert size={12} aria-hidden />}>
            {pack.errors.length} problem{pack.errors.length === 1 ? '' : 's'}
          </Pill>
        ) : undefined
      }
    >
      <div className="flex flex-col gap-3">
        {pack.levels.length > 0 ? (
          <ul className="m-0 flex list-none flex-col gap-2 p-0">
            {pack.levels.map((l) => (
              <li key={l.id}>
                <QuestLink
                  to={`/community/${encodeURIComponent(l.id)}`}
                  data-testid={`community-level-${l.id}`}
                  className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-md border border-night-700 bg-night-900/60 px-3 py-2.5 transition-colors duration-fast hover:border-flood-500/50 hover:bg-night-800"
                >
                  <span className="tabular w-6 font-display text-lg font-bold text-chalk-dim">
                    {String(l.number).padStart(2, '0')}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-md font-semibold text-chalk">{l.title}</span>
                    <span className="block text-xs text-chalk-dim">By {byline(l.author)}</span>
                  </span>
                  <Pill size="sm">{MODE_LABEL[l.mode]}</Pill>
                  <Pill size="sm" tone={STATUS_TONE[l.status]}>
                    {STATUS_LABEL[l.status]}
                  </Pill>
                </QuestLink>
              </li>
            ))}
          </ul>
        ) : (
          <p className="m-0 text-sm text-chalk-dim">No playable level in this pack yet.</p>
        )}
        {pack.errors.length > 0 ? (
          <div
            className="rounded-md border border-wicket/40 bg-wicket/5 p-3"
            data-testid={`pack-errors-${pack.id}`}
          >
            <div className="label-caps text-xs text-wicket">
              {pack.levels.length > 0
                ? 'Some files in this pack are skipped'
                : 'This pack could not be loaded'}
            </div>
            <pre className="m-0 mt-2 overflow-x-auto whitespace-pre-wrap font-mono text-xs leading-relaxed text-chalk">
              {pack.errors.join('\n')}
            </pre>
          </div>
        ) : null}
      </div>
    </Panel>
  );
}

export function Community() {
  const [list, setList] = useState<CommunityList | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    communityApi.list().then(
      (l) => live && setList(l),
      (e: unknown) => live && setError(e instanceof ApiError ? e.message : String(e)),
    );
    return () => {
      live = false;
    };
  }, []);

  return (
    <ToolPage
      eyebrow="Community levels"
      title="Written by other players"
      testId="community"
      blurb="Practice levels from the community folder of the game. They award no XP and no badges, never lock, and are not part of the season. Each one names its author."
    >
      {error ? (
        <EmptyState title="Could not load the community levels">{error}</EmptyState>
      ) : !list ? (
        <div className="flex flex-col gap-3" aria-busy="true">
          <Skeleton className="h-24 rounded-lg" label="Loading the community levels" />
        </div>
      ) : list.packs.length === 0 ? (
        <EmptyState
          icon={<Users size={22} aria-hidden />}
          title="No community levels yet"
          action={
            <QuestLink
              to="/studio"
              className="inline-flex h-10 items-center gap-2 rounded-md bg-flood-500 px-4 text-md font-semibold text-on-flood hover:bg-flood-400"
            >
              <PencilRuler size={16} aria-hidden /> Write the first one
            </QuestLink>
          }
        >
          Levels live in levels/community/&lt;pack&gt;/ in the game folder. Write one in the studio,
          or copy a pack and edit it.
        </EmptyState>
      ) : (
        <div className="flex flex-col gap-4">
          <p className="m-0 text-sm text-chalk-dim" data-testid="community-count">
            {list.levelCount} level{list.levelCount === 1 ? '' : 's'} in {list.packs.length} pack
            {list.packs.length === 1 ? '' : 's'}
            {list.errorCount > 0
              ? `, ${list.errorCount} problem${list.errorCount === 1 ? '' : 's'} listed below`
              : ''}
            .
          </p>
          {list.packs.map((p) => (
            <PackPanel key={p.id} pack={p} />
          ))}
          <Card tone="inset" padding="md">
            <p className="m-0 text-sm text-chalk-dim">
              Want yours here?{' '}
              <QuestLink to="/studio" className="text-flood-400 hover:text-flood-500">
                Write it in the studio
              </QuestLink>
              , play-test it, and send the files as a pull request.
            </p>
          </Card>
        </div>
      )}
    </ToolPage>
  );
}
