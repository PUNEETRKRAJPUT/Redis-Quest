import { useEffect, useState } from 'react';
import { api } from '../api';
import { IconExternal } from '../icons';
import { ShowMe } from '../showme';
import { useQuest } from '../store';
import { rebuiltIn } from '../level/interview';
import type { LevelData } from '../types';
import { buildImpact } from '../impact';
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
    <section className="built-card" data-testid={`built-${levelId}`}>
      <h2>{title}</h2>
      <p className="muted">{chapter}</p>
      {info?.interview?.drawn ? (
        <p className="muted" data-testid={`built-drawn-${levelId}`}>
          The interviewer picked: {info.interview.drawn.title}.
        </p>
      ) : null}
      {rebuilt ? (
        <p className="rebuilt" data-testid={`built-rebuilt-${levelId}`}>
          {rebuilt[0]?.toUpperCase()}
          {rebuilt.slice(1)}.
        </p>
      ) : null}
      {showMe === undefined ? (
        <p className="muted">Loading...</p>
      ) : showMe ? (
        <ShowMe spec={showMe} playerId={playerId} />
      ) : (
        <p className="muted">This level has no live panel.</p>
      )}
    </section>
  );
}

/** "What you built": every passed level with its show-me component running on the learner's own keys. */
export function Built() {
  const chapters = useQuest((s) => s.chapters);
  const progress = useQuest((s) => s.progress);
  const health = useQuest((s) => s.health);
  if (!chapters || !progress)
    return (
      <main className="page">
        <p className="muted">Loading...</p>
      </main>
    );
  const passed = chapters.chapters.flatMap((c) =>
    c.levels.filter((l) => l.status === 'passed').map((l) => ({ ...l, chapter: c.title })),
  );
  return (
    <main className="page" data-testid="built">
      <h1>What you built</h1>
      <p className="muted">
        Every level you passed, running live on your own keys.{' '}
        <a
          href={insightUrl(health)}
          data-testid="insight-link"
          target="_blank"
          rel="noopener noreferrer"
        >
          Open Redis Insight <IconExternal size={14} />
          <span className="sr-only"> (opens in a new tab)</span>
        </a>{' '}
        to see the same keys with a mouse.
      </p>
      <Story />
      <ImpactLog impact={buildImpact(chapters.chapters, progress)} />
      {passed.length === 0 ? (
        <p className="callout">Nothing yet. Pass your first level and it shows up here.</p>
      ) : null}
      <div className="built-grid">
        {passed.map((l) => (
          <BuiltCard
            key={l.id}
            levelId={l.id}
            title={l.title}
            chapter={l.chapter}
            playerId={progress.player.id}
          />
        ))}
      </div>
    </main>
  );
}
