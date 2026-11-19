'use client';

// What the Vite app's `App` did, mounted once from the root layout so it survives every client navigation: it
// starts the store and the socket, shows the boot states, and around the page the header, the mirror banner and
// the skip link. Pages are static shells; everything that needs the engine happens here or below, in the browser.

import { Suspense, useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import {
  IconBall,
  IconCode,
  IconLog,
  IconMap,
  IconPulse,
  IconTerminal,
  IconTrophy,
} from '../icons';
import { parseHash, parsePath, pathFor } from '../routes';
import type { Route } from '../routes';
import { Welcome } from '../screens/Welcome';
import { useQuest } from '../store';
import { startWs } from '../ws';
import { QuestLink } from './QuestLink';

const NAV: { route: Route; label: string; icon: typeof IconMap }[] = [
  { route: { name: 'home' }, label: 'Map', icon: IconMap },
  { route: { name: 'terminal' }, label: 'Terminal', icon: IconTerminal },
  { route: { name: 'editor' }, label: 'Editor', icon: IconCode },
  { route: { name: 'logs' }, label: 'Logs', icon: IconLog },
  { route: { name: 'metrics' }, label: 'Metrics', icon: IconPulse },
  { route: { name: 'built' }, label: 'What you built', icon: IconTrophy },
];

// usePathname suspends while prerendering a route whose params are only known at request time (/level/[id]), so
// the links live in their own Suspense boundary; the fallback is the same links with none marked active.
function NavLinks({ current }: { current: Route | null }) {
  const active = (r: Route) =>
    current !== null &&
    (r.name === current.name || (r.name === 'home' && current.name === 'level'));
  return (
    <nav aria-label="Main">
      {NAV.map((n) => {
        const Icon = n.icon;
        const on = active(n.route);
        return (
          <QuestLink
            key={n.label}
            to={n.route}
            className={on ? 'nav active' : 'nav'}
            aria-current={on ? 'page' : undefined}
          >
            <Icon size={16} /> <span>{n.label}</span>
          </QuestLink>
        );
      })}
    </nav>
  );
}

function ActiveNav() {
  const pathname = usePathname();
  return <NavLinks current={parsePath(pathname ?? '/')} />;
}

function Header() {
  const progress = useQuest((s) => s.progress);
  const ws = useQuest((s) => s.wsState);
  const redisUp = useQuest((s) => s.redisUp);
  const live = ws === 'open' && redisUp !== false;
  return (
    <header className="topbar">
      <QuestLink className="brand" to={{ name: 'home' }} aria-label="Redis Quest, home">
        <IconBall size={22} /> <span>Redis Quest</span>
      </QuestLink>
      <Suspense fallback={<NavLinks current={null} />}>
        <ActiveNav />
      </Suspense>
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
        <span className="muted" data-testid="conn-state">
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

/**
 * Old bookmarks (`/#/level/x`, `/#/terminal`) land on the real route without adding a history entry, on load and
 * when only the hash changes (an old link inside level text, or a typed URL on an open tab).
 */
function useLegacyHashRedirect() {
  const router = useRouter();
  useEffect(() => {
    const follow = () => {
      const route = parseHash(window.location.hash);
      if (route) router.replace(pathFor(route));
    };
    follow();
    window.addEventListener('hashchange', follow);
    return () => window.removeEventListener('hashchange', follow);
  }, [router]);
}

export function GameShell({ children }: { children: ReactNode }) {
  const boot = useQuest((s) => s.boot);
  const bootError = useQuest((s) => s.bootError);
  const errors = useQuest((s) => s.invalidErrors);
  const init = useQuest((s) => s.init);

  useLegacyHashRedirect();

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
      <Header />
      <MirrorBanner />
      <div id="main" tabIndex={-1}>
        {children}
      </div>
    </>
  );
}
