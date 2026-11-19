'use client';

import { ExternalLink } from 'lucide-react';
import { motion } from 'motion/react';
import { useEffect, useState } from 'react';
import { api } from '../api';
import { ShowMe } from '../showme';
import { useQuest } from '../store';
import { rebuiltIn } from '../level/interview';
import type { LevelData } from '../types';
import { buildImpact, headlineWin } from '../impact';
import { PlayerCard } from '../career/PlayerCard';
import { ToolPage } from '../career/ToolPage';
import { Card, Pill, ProgressBar, rise, Skeleton } from '../design';
import { hydrateProfile, jerseyColor, useProfile } from '../onboarding/profile';
import { ImpactLog } from './ImpactLog';
import { Story } from './Story';

const DEFAULT_INSIGHT_PORT = '5540';

/**
 * F-07. Nothing the engine serves exposes INSIGHT_PORT (checked: GET /health, /api/progress, /api/target, /api/chapters),
 * so the link follows the page's own hostname and a port in this order: `insightUrl` from GET /health if the engine ever
 * adds it (requested in docs/handoffs/F-UI.md), localStorage `quest.insightPort`, then the .env.example default 5540.
 */
export function insightLink(
  health: { insightUrl?: unknown } | null | undefined,
  hostname: string,
  stored: string | null,
): string {
  if (health && typeof health.insightUrl === 'string' && /^https?:\/\//.test(health.insightUrl))
    return health.insightUrl;
  const port = stored && /^\d{2,5}$/.test(stored) ? stored : DEFAULT_INSIGHT_PORT;
  const host =
    hostname.includes(':') && !hostname.startsWith('[') ? `[${hostname}]` : hostname || 'localhost';
  return `http://${host}:${port}/`;
}

function insightUrl(health: { insightUrl?: unknown } | null | undefined): string {
  let stored: string | null = null;
  try {
    stored = localStorage.getItem('quest.insightPort');
  } catch {
    /* storage can be blocked */
  }
  return insightLink(health, window.location.hostname, stored);
}

function BuiltCard({
  levelId,
  title,
  chapter,
  playerId,
}: {
  levelId: string;
  title: string;
  chapter: string;
  playerId: string;
}) {
  const [info, setInfo] = useState<Pick<LevelData, 'showMe' | 'interview'> | null | undefined>(
    undefined,
  );
  useEffect(() => {
    api
      .level(levelId)
      .then((l) => setInfo({ showMe: l.showMe, interview: l.interview ?? null }))
      .catch(() => setInfo(null));
  }, [levelId]);
  const showMe = info === undefined ? undefined : (info?.showMe ?? null);
  const rebuilt = rebuiltIn(info?.interview);
  return (
    <Card
      tone="raised"
      padding="md"
      data-testid={`built-${levelId}`}
      className="flex min-w-0 flex-col gap-3"
    >
      <div>
        <h3 className="font-display text-lg font-semibold uppercase tracking-[0.03em] text-chalk">
          {title}
        </h3>
        <p className="text-sm text-chalk-dim">{chapter}</p>
      </div>
      {info?.interview?.drawn ? (
        <p className="text-sm text-chalk-dim" data-testid={`built-drawn-${levelId}`}>
          The interviewer picked: {info.interview.drawn.title}.
        </p>
      ) : null}
      {rebuilt ? (
        <p className="text-sm font-medium text-turf" data-testid={`built-rebuilt-${levelId}`}>
          {rebuilt[0]?.toUpperCase()}
          {rebuilt.slice(1)}.
        </p>
      ) : null}
      <div className="min-w-0 rounded-md border border-night-600/60 bg-night-950/60 p-3">
        {showMe === undefined ? (
          <Skeleton lines={3} label="Loading the live panel" />
        ) : showMe ? (
          <ShowMe spec={showMe} playerId={playerId} />
        ) : (
          <p className="text-sm text-chalk-dim">This level has no live panel.</p>
        )}
      </div>
    </Card>
  );
}

/** "What you built": the player card, the impact timeline, and every passed level running on the learner's keys. */
export function Built() {
  const chapters = useQuest((s) => s.chapters);
  const progress = useQuest((s) => s.progress);
  const health = useQuest((s) => s.health);
  const jersey = useProfile((s) => s.jersey);
  useEffect(() => {
    void hydrateProfile();
  }, []);
  if (!chapters || !progress)
    return (
      <ToolPage eyebrow="Career" title="What you built">
        <Skeleton lines={4} label="Loading" />
      </ToolPage>
    );
  const impact = buildImpact(chapters.chapters, progress);
  const passed = chapters.chapters.flatMap((c) =>
    c.levels.filter((l) => l.status === 'passed').map((l) => ({ ...l, chapter: c.title })),
  );
  const total = chapters.chapters.reduce((n, c) => n + c.levels.length, 0);
  const chaptersDone = chapters.chapters.filter(
    (c) => c.levels.length > 0 && c.levels.every((l) => l.status === 'passed'),
  ).length;
  return (
    <ToolPage
      eyebrow="Career"
      title="What you built"
      blurb="The card you can show a friend or an interviewer: every number below was measured on your machine, from your own save."
      testId="built"
    >
      <motion.div variants={rise} initial="hidden" animate="show">
        <PlayerCard
          name={progress.player.name}
          xp={progress.xp}
          badges={progress.badges}
          passed={passed.length}
          total={total}
          chaptersDone={chaptersDone}
          chaptersTotal={chapters.chapters.length}
          jersey={jerseyColor(jersey)}
          win={headlineWin(impact.entries)}
        />
      </motion.div>

      <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,1fr)_400px]">
        <motion.div variants={rise} initial="hidden" animate="show" transition={{ delay: 0.06 }}>
          <ImpactLog impact={impact} />
        </motion.div>
        <motion.div variants={rise} initial="hidden" animate="show" transition={{ delay: 0.12 }}>
          <Story />
        </motion.div>
      </div>

      <section aria-labelledby="built-title" className="flex flex-col gap-5">
        <div className="flex flex-wrap items-end gap-x-6 gap-y-2">
          <div className="min-w-0 flex-1">
            <h2
              id="built-title"
              className="font-display text-xl font-semibold uppercase tracking-[0.04em] text-chalk"
            >
              Built, chapter by chapter
            </h2>
            <p className="mt-1 text-md text-chalk-dim">
              Every level you passed, running live on your own keys. Open Redis Insight to see the
              same keys with a mouse.
            </p>
          </div>
          <a
            href={insightUrl(health)}
            data-testid="insight-link"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex h-8 items-center gap-1.5 rounded-sm border border-night-600 bg-night-900/70 px-3 text-sm font-semibold text-chalk shadow-hairline transition-colors duration-fast hover:border-chalk-faint/70 hover:bg-night-800"
          >
            Open Redis Insight <ExternalLink size={14} aria-hidden />
            <span className="sr-only"> (opens in a new tab)</span>
          </a>
        </div>
        {passed.length === 0 ? (
          <p className="rounded-lg border border-dashed border-night-600 bg-night-900/60 px-5 py-6 text-md text-chalk-dim">
            Nothing yet. Pass your first level and it shows up here.
          </p>
        ) : null}
        {chapters.chapters.map((c, ci) => {
          const done = c.levels.filter((l) => l.status === 'passed');
          if (done.length === 0) return null;
          return (
            <div key={c.id} data-testid={`built-chapter-${c.id}`} className="flex flex-col gap-3">
              <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
                <span className="tabular grid h-9 min-w-9 place-items-center rounded-sm border border-night-600 bg-night-800 px-2 font-display text-lg font-bold text-flood-400 shadow-hairline">
                  {String(ci).padStart(2, '0')}
                </span>
                <h3 className="font-display text-lg font-semibold uppercase tracking-[0.04em] text-chalk">
                  {c.title}
                </h3>
                {done.length === c.levels.length ? (
                  <Pill tone="turf" variant="status">
                    Finished
                  </Pill>
                ) : null}
                <div className="ml-auto w-48">
                  <ProgressBar
                    size="sm"
                    tone="turf"
                    label={`${c.title} progress`}
                    showLabel={false}
                    value={done.length}
                    max={c.levels.length}
                    valueText={`${done.length} of ${c.levels.length} levels`}
                  />
                </div>
                <span className="tabular font-mono text-xs text-chalk-dim">
                  {done.length} of {c.levels.length} levels
                </span>
              </div>
              <div className="grid gap-4 lg:grid-cols-2">
                {done.map((l) => (
                  <BuiltCard
                    key={l.id}
                    levelId={l.id}
                    title={l.title}
                    chapter={c.title}
                    playerId={progress.player.id}
                  />
                ))}
              </div>
            </div>
          );
        })}
      </section>
    </ToolPage>
  );
}
