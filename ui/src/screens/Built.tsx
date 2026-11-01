import { useEffect, useState } from 'react';
import { api } from '../api';
import { IconExternal } from '../icons';
import { ShowMe } from '../showme';
import { useQuest } from '../store';

function insightUrl(): string {
  try {
    const p = localStorage.getItem('quest.insightPort');
    if (p && /^\d{2,5}$/.test(p)) return `http://localhost:${p}/`;
  } catch {
    /* storage can be blocked */
  }
  // The engine does not expose the Insight port; 5540 is the default in .env.example.
  return 'http://localhost:5540/';
}

function BuiltCard({ levelId, title, chapter, playerId }: { levelId: string; title: string; chapter: string; playerId: string }) {
  const [showMe, setShowMe] = useState<string | null | undefined>(undefined);
  useEffect(() => {
    api.level(levelId).then((l) => setShowMe(l.showMe)).catch(() => setShowMe(null));
  }, [levelId]);
  return (
    <section className="built-card" data-testid={`built-${levelId}`}>
      <h2>{title}</h2>
      <p className="muted">{chapter}</p>
      {showMe === undefined ? <p className="muted">Loading...</p> : showMe ? <ShowMe id={showMe} levelId={levelId} playerId={playerId} /> : <p className="muted">This level has no live panel.</p>}
    </section>
  );
}

/** "What you built": every passed level with its show-me component running on the learner's own keys. */
export function Built() {
  const chapters = useQuest((s) => s.chapters);
  const progress = useQuest((s) => s.progress);
  if (!chapters || !progress) return <main className="page"><p className="muted">Loading...</p></main>;
  const passed = chapters.chapters.flatMap((c) => c.levels.filter((l) => l.status === 'passed').map((l) => ({ ...l, chapter: c.title })));
  return (
    <main className="page" data-testid="built">
      <h1>What you built</h1>
      <p className="muted">
        Every level you passed, running live on your own keys.{' '}
        <a href={insightUrl()} target="_blank" rel="noopener noreferrer">
          Open Redis Insight <IconExternal size={14} />
          <span className="sr-only"> (opens in a new tab)</span>
        </a>{' '}
        to see the same keys with a mouse.
      </p>
      {passed.length === 0 ? <p className="callout">Nothing yet. Pass your first level and it shows up here.</p> : null}
      <div className="built-grid">
        {passed.map((l) => (
          <BuiltCard key={l.id} levelId={l.id} title={l.title} chapter={l.chapter} playerId={progress.player.id} />
        ))}
      </div>
    </main>
  );
}
