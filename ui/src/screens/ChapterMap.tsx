import { useState } from 'react';
import { IconCheck, IconChevron, IconHalf, IconLock, IconPlay, IconStar } from '../icons';
import { Thread } from '../level/Thread';
import { hrefFor } from '../router';
import { useQuest } from '../store';
import type { LevelStatus } from '../types';

const STATUS_LABEL: Record<LevelStatus, string> = { locked: 'Locked', available: 'Ready', in_progress: 'In progress', passed: 'Passed' };

function StatusIcon({ s }: { s: LevelStatus }) {
  const I = s === 'locked' ? IconLock : s === 'passed' ? IconCheck : s === 'in_progress' ? IconHalf : IconPlay;
  return <I size={18} title={STATUS_LABEL[s]} />;
}

export function ChapterMap() {
  const chapters = useQuest((s) => s.chapters);
  const progress = useQuest((s) => s.progress);
  const [openThread, setOpenThread] = useState<string | null>(null);
  if (!chapters || !progress) return <main className="page"><p className="muted">Loading the map...</p></main>;
  const badges = progress.badges;
  return (
    <main className="page" data-testid="chapter-map">
      <header className="map-head">
        <div>
          <h1>Hello, {progress.player.name}</h1>
          <p className="muted">Pick up where you left off. Each level is one incident with a real Redis answer.</p>
        </div>
        <div className="xp-card" aria-label="Your score">
          <span className="xp-num" data-testid="xp">{progress.xp}</span>
          <span className="muted">XP</span>
          <ul className="badges" aria-label="Badges earned">
            {badges.length === 0 ? <li className="muted">no badges yet</li> : badges.map((b) => <li key={b}><IconStar size={14} /> {b}</li>)}
          </ul>
        </div>
      </header>
      <ol className="path">
        {chapters.chapters.map((c, ci) => {
          const done = c.levels.filter((l) => l.status === 'passed').length;
          return (
            <li key={c.id} className="chapter" data-testid={`chapter-${c.id}`}>
              <div className="chapter-rail" aria-hidden="true"><span className={done === c.levels.length ? 'dot done' : 'dot'}>{ci}</span></div>
              <div className="chapter-card">
                <h2>{c.title}</h2>
                <p className="muted">{done} of {c.levels.length} levels passed</p>
                {c.incident.length ? (
                  <>
                    <button type="button" className="link" aria-expanded={openThread === c.id} onClick={() => setOpenThread(openThread === c.id ? null : c.id)}>
                      <span className={openThread === c.id ? 'chev down' : 'chev'}><IconChevron size={14} /></span> Read the chapter thread
                    </button>
                    {openThread === c.id ? <Thread messages={c.incident} label={`${c.title} thread`} /> : null}
                  </>
                ) : null}
                <ul className="levels">
                  {c.levels.map((l, i) => {
                    const locked = l.status === 'locked';
                    const body = (
                      <>
                        <span className={`lv-icon ${l.status}`}><StatusIcon s={l.status} /></span>
                        <span className="lv-title">{i + 1}. {l.title}</span>
                        <span className="pill">{l.mode}</span>
                        <span className="pill">{l.xp} XP</span>
                        <span className="lv-status">{STATUS_LABEL[l.status]}</span>
                      </>
                    );
                    return (
                      <li key={l.id}>
                        {locked ? (
                          <span className="level-link locked" aria-disabled="true" data-testid={`level-${l.id}`}>{body}</span>
                        ) : (
                          <a className={`level-link ${l.status}`} href={hrefFor({ name: 'level', id: l.id })} data-testid={`level-${l.id}`}>{body}</a>
                        )}
                      </li>
                    );
                  })}
                </ul>
              </div>
            </li>
          );
        })}
      </ol>
    </main>
  );
}
