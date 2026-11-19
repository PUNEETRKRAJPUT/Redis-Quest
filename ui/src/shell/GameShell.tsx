'use client';

// Mounted once from the root layout so it survives every client navigation. It starts the store and the socket,
// shows the boot states, and around the page puts the scoreboard HUD, the rain-delay strip, the mirror banner,
// the command palette, the shortcuts sheet and the event toasts. Pages are static shells; everything that needs
// the engine happens here or below, in the browser.

import { ViewTransition, useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { useRouter } from 'next/navigation';
import { Kbd } from '@/design/components/controls';
import { play } from '@/design/sound';
import { parseHash, pathFor } from '../routes';
import type { Route } from '../routes';
import { Welcome } from '../screens/Welcome';
import { useQuest } from '../store';
import { startWs } from '../ws';
import { BootInvalid, BootLoading, BootOffline } from './BootScreens';
import { CommandPalette } from './CommandPalette';
import { Hud, useModKey } from './Hud';
import { MirrorBanner } from './MirrorBanner';
import { RainDelayStrip } from './RainDelay';
import { ShortcutsSheet } from './ShortcutsSheet';
import { NAV } from './nav';
import { useChromeHeight, useEventToasts, useShellKeys } from './useShellEffects';

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

/** After `g`: which letter goes where. Shown for a moment so the shortcut can be learned, not memorised. */
function GoHint({ armed }: { armed: boolean }) {
  return (
    <AnimatePresence>
      {armed && (
        <motion.div
          data-ds=""
          aria-hidden
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.15 }}
          className="pointer-events-none fixed bottom-5 left-1/2 z-[65] flex -translate-x-1/2 items-center gap-3 rounded-full border border-night-600 bg-night-800/95 px-4 py-2 text-sm text-chalk-dim shadow-pop backdrop-blur"
        >
          <span className="label-caps text-md text-flood-400">Go to</span>
          {NAV.map((n) => (
            <span key={n.id} className="flex items-center gap-1.5">
              <Kbd size="sm">{n.key.toUpperCase()}</Kbd>
              {n.label}
            </span>
          ))}
        </motion.div>
      )}
    </AnimatePresence>
  );
}

function ReadyShell({ children }: { children: ReactNode }) {
  const router = useRouter();
  const mod = useModKey();
  const [palette, setPalette] = useState(false);
  const [help, setHelp] = useState(false);
  const chrome = useRef<HTMLDivElement>(null);
  useChromeHeight(chrome);
  useEventToasts();

  // Link clicks and these navigations carry the same transition type, so only they cross-fade <main>.
  const go = (route: Route) => router.push(pathFor(route), { transitionTypes: ['rq-nav'] });

  const armed = useShellKeys({
    onPalette: () => {
      setHelp(false);
      setPalette((o) => {
        if (!o) play('tick');
        return !o;
      });
    },
    onHelp: () => setHelp(true),
    onGo: (route) => {
      play('tick');
      go(route);
    },
  });

  return (
    <div className="flex min-h-dvh flex-col">
      <button
        type="button"
        data-ds=""
        // Parked above the window until it takes focus, then it slides down into view.
        className="fixed left-4 top-3 z-[80] -translate-y-[200%] rounded-md bg-flood-500 px-4 py-2 text-md font-semibold text-on-flood shadow-pop focus:translate-y-0"
        onClick={() => document.getElementById('main')?.focus()}
      >
        Skip to content
      </button>
      <div ref={chrome} className="sticky top-0 z-40">
        <Hud
          mod={mod}
          onPalette={() => {
            play('tick');
            setPalette(true);
          }}
          onShortcuts={() => setHelp(true)}
        />
        <RainDelayStrip />
        <MirrorBanner />
      </div>
      <ViewTransition default="none" update={{ 'rq-nav': 'rq-fade', default: 'none' }}>
        <div id="main" tabIndex={-1} className="min-h-0 flex-1 outline-none">
          {children}
        </div>
      </ViewTransition>
      <CommandPalette
        open={palette}
        onClose={() => setPalette(false)}
        onShortcuts={() => setHelp(true)}
        go={go}
      />
      <ShortcutsSheet open={help} onClose={() => setHelp(false)} mod={mod} />
      <GoHint armed={armed} />
    </div>
  );
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

  if (boot === 'loading') return <BootLoading />;
  if (boot === 'welcome') return <Welcome />;
  if (boot === 'offline') return <BootOffline error={bootError} />;
  if (boot === 'invalid') return <BootInvalid errors={errors} />;
  return <ReadyShell>{children}</ReadyShell>;
}
