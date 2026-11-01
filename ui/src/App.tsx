import { useEffect, useState } from 'react';
import { IconBall, IconCode, IconLog, IconMap, IconPulse, IconTerminal, IconTrophy } from './icons';
import { EditorPanel } from './panels/EditorPanel';
import { LogsPanel } from './panels/LogsPanel';
import { MetricsPanel } from './panels/MetricsPanel';
import { TerminalPanel } from './panels/TerminalPanel';
import { hrefFor, useRoute } from './router';
import type { Route } from './router';
import { Built } from './screens/Built';
import { ChapterMap } from './screens/ChapterMap';
import { LevelScreen } from './screens/Level';
import { ShowMeGallery } from './screens/ShowMeGallery';
import { Welcome } from './screens/Welcome';
import { useQuest } from './store';
import { startWs } from './ws';

const NAV: { route: Route; label: string; icon: typeof IconMap }[] = [
  { route: { name: 'home' }, label: 'Map', icon: IconMap },
  { route: { name: 'terminal' }, label: 'Terminal', icon: IconTerminal },
  { route: { name: 'editor' }, label: 'Editor', icon: IconCode },
  { route: { name: 'logs' }, label: 'Logs', icon: IconLog },
  { route: { name: 'metrics' }, label: 'Metrics', icon: IconPulse },
  { route: { name: 'built' }, label: 'What you built', icon: IconTrophy },
];

function Header({ route }: { route: Route }) {
  const progress = useQuest((s) => s.progress);
  const ws = useQuest((s) => s.wsState);
  const redisUp = useQuest((s) => s.redisUp);
  const live = ws === 'open' && redisUp !== false;
  const active = (r: Route) =>
    r.name === route.name || (r.name === 'home' && route.name === 'level');
  return (
    <header className="topbar">
      <a className="brand" href="#/" aria-label="Redis Quest, home">
        <IconBall size={22} /> <span>Redis Quest</span>
      </a>
      <nav aria-label="Main">
        {NAV.map((n) => {
          const Icon = n.icon;
          return (
            <a
              key={n.label}
              href={hrefFor(n.route)}
              className={active(n.route) ? 'nav active' : 'nav'}
              aria-current={active(n.route) ? 'page' : undefined}
            >
              <Icon size={16} /> <span>{n.label}</span>
            </a>
          );
        })}
      </nav>
      <div className="status">
        <span
          className={live ? 'dot-live on' : 'dot-live'}
          role="img"
          aria-label={
            live
              ? 'Connected to the engine and Redis'
              : ws !== 'open'
                ? 'Reconnecting to the engine'
                : 'Redis is down'
          }
        />
        <span className="muted">
          {ws !== 'open' ? 'reconnecting' : redisUp === false ? 'redis down' : 'live'}
        </span>
        {progress ? (
          <span className="who-chip">
            {progress.player.name} <strong>{progress.xp} XP</strong>
          </span>
        ) : null}
      </div>
    </header>
  );
}

function MirrorBanner() {
  const mirror = useQuest((s) => s.mirror);
  const restore = useQuest((s) => s.restore);
  const [busy, setBusy] = useState(false);
  if (!mirror || mirror.redis !== 'up' || (mirror.present && mirror.inSync)) return null;
  return (
    <div className="banner warn" role="alert" data-testid="mirror-banner">
      <span>
        Your save file is missing from Redis (a FLUSHALL, or a fresh volume). Your progress is safe
        in the progress file on your Mac.
      </span>
      <button
        type="button"
        className="btn small"
        disabled={busy}
        onClick={() => {
          setBusy(true);
          void restore().finally(() => setBusy(false));
        }}
      >
        {busy ? 'Restoring...' : 'Restore my save file'}
      </button>
    </div>
  );
}

function Screen({ route }: { route: Route }) {
  switch (route.name) {
    case 'level':
      return <LevelScreen key={route.id} id={route.id} />;
    case 'terminal':
      return (
        <main className="page">
          <h1>Terminal</h1>
          <p className="muted">
            The same Redis your app uses. Dangerous commands get a warning, they are not blocked.
          </p>
          <TerminalPanel height={520} />
        </main>
      );
    case 'editor':
      return (
        <main className="page">
          <h1>Editor</h1>
          <EditorPanel height={560} />
        </main>
      );
    case 'logs':
      return (
        <main className="page">
          <h1>Logs</h1>
          <LogsPanel height={520} />
        </main>
      );
    case 'metrics':
      return (
        <main className="page">
          <h1>Metrics</h1>
          <MetricsPanel />
        </main>
      );
    case 'built':
      return <Built />;
    case 'showme':
      return <ShowMeGallery />;
    default:
      return <ChapterMap />;
  }
}

export function App() {
  const route = useRoute();
  const boot = useQuest((s) => s.boot);
  const bootError = useQuest((s) => s.bootError);
  const errors = useQuest((s) => s.invalidErrors);
  const init = useQuest((s) => s.init);

  useEffect(() => {
    void init();
    startWs();
  }, [init]);

  // While the stack boots the proxy answers 502: keep asking instead of leaving the learner on an error.
  useEffect(() => {
    if (boot !== 'offline') return;
    const t = setInterval(() => void init(), 2500);
    return () => clearInterval(t);
  }, [boot, init]);

  if (boot === 'loading')
    return (
      <main className="page narrow">
        <p className="muted">Starting...</p>
      </main>
    );
  if (boot === 'welcome') return <Welcome />;
  if (boot === 'offline')
    return (
      <main className="page narrow" data-testid="offline">
        <h1>The game engine is not answering</h1>
        <p>{bootError}</p>
        <p>
          Start the stack from the repo folder with <code>./scripts/start</code>. This page keeps
          trying and will continue on its own.
        </p>
      </main>
    );
  if (boot === 'invalid')
    return (
      <main className="page narrow" data-testid="levels-invalid">
        <h1>The level files have errors</h1>
        <p>The engine refuses to run until they are fixed:</p>
        <ul className="errors">
          {errors.map((e, i) => (
            <li key={i}>
              <code>{e}</code>
            </li>
          ))}
        </ul>
      </main>
    );
  return (
    <>
      <button
        type="button"
        className="skip"
        onClick={() => document.getElementById('main')?.focus()}
      >
        Skip to content
      </button>
      <Header route={route} />
      <MirrorBanner />
      <div id="main" tabIndex={-1}>
        <Screen route={route} />
      </div>
    </>
  );
}
