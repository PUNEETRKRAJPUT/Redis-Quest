// E-03: which Redis the game talks to. A select in the terminal's header with the presets Chapter 5 walks through
// (single node, no persistence, replica, Sentinel, cluster) and a custom string. Choosing one asks the engine
// (`PUT /api/target`); the app and the runner follow the engine within about two seconds.
import { clsx } from 'clsx';
import { ChevronDown, CircleAlert } from 'lucide-react';
import { useEffect, useState } from 'react';
import { create } from 'zustand';
import { api } from '../api';
import { Button } from '../design';
import { useQuest } from '../store';
import type { TargetInfo } from '../types';

export interface TargetPreset {
  id: string;
  label: string;
  url: string;
}

export const TARGET_PRESETS: readonly TargetPreset[] = [
  { id: 'single', label: 'Single node (redis:6379)', url: 'redis://redis:6379' },
  {
    id: 'nopersist',
    label: 'No persistence (redis-nopersist)',
    url: 'redis://redis-nopersist:6379',
  },
  { id: 'replica', label: 'Replica, read-only (redis-replica)', url: 'redis://redis-replica:6379' },
  {
    id: 'sentinel',
    label: 'Sentinel (mymaster via sentinel-1..3)',
    url: 'sentinel://mymaster@sentinel-1:26379,sentinel-2:26379,sentinel-3:26379',
  },
  {
    id: 'cluster',
    label: 'Cluster (redis-c1..c3)',
    url: 'cluster://redis-c1:6379,redis-c2:6379,redis-c3:6379',
  },
];
export const CUSTOM_ID = 'custom';
export const CUSTOM_LABEL = 'Custom…';
export const FOLLOW_COPY = 'The app and the runner follow within about two seconds.';

/** The preset a URL is, or `custom`. */
export function presetIdFor(url: string | undefined): string {
  return TARGET_PRESETS.find((p) => p.url === url)?.id ?? CUSTOM_ID;
}

/** Terminal prompt text: the node for a single Redis, the master for Sentinel, the cluster otherwise. */
export function promptFor(info: Pick<TargetInfo, 'kind' | 'redisUrl' | 'master'> | null): string {
  if (!info) return 'redis> ';
  if (info.kind === 'single') {
    try {
      const u = new URL(info.redisUrl);
      return `${u.hostname}:${u.port || '6379'}> `;
    } catch {
      return 'redis> ';
    }
  }
  if (info.kind === 'sentinel') {
    const name = /^sentinel:\/\/([^@]+)@/.exec(info.redisUrl)?.[1] ?? 'sentinel';
    return `${name}@${info.master ?? '?'}> `;
  }
  return 'cluster> ';
}

export type SwitchResult = { ok: true; info: TargetInfo } | { ok: false; message: string };

/** What choosing a target does: ask the engine; a refusal is the engine's own message and changes nothing. */
export async function switchTarget(
  url: string,
  setTarget: (url: string) => Promise<TargetInfo> = api.setTarget,
): Promise<SwitchResult> {
  const text = url.trim();
  if (!text) return { ok: false, message: 'Type a target first, for example redis://redis:6379.' };
  try {
    return { ok: true, info: await setTarget(text) };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : String(e) };
  }
}

interface TargetState {
  info: TargetInfo | null;
  refresh: () => Promise<void>;
  set: (info: TargetInfo) => void;
}

/** One copy of the engine's answer for the header and the terminal prompt. */
export const useTarget = create<TargetState>((set) => ({
  info: null,
  async refresh() {
    try {
      set({ info: await api.target() });
    } catch {
      /* the header keeps what it had; the engine banner says when the engine is gone */
    }
  },
  set: (info) => set({ info }),
}));

/** Pure view, so it renders the same on the server in tests. */
export function TargetSwitchView({
  info,
  selected,
  customText = '',
  busy = false,
  message = null,
  onSelect,
  onCustomText,
  onCustomGo,
}: {
  info: TargetInfo | null;
  selected: string;
  customText?: string;
  busy?: boolean;
  message?: string | null;
  onSelect?: (id: string) => void;
  onCustomText?: (text: string) => void;
  onCustomGo?: () => void;
}) {
  const up = info?.state === 'up';
  const where = info
    ? `${info.description}${info.master ? `, master ${info.master}` : ''}`
    : 'asking the engine…';
  return (
    <div
      data-ds=""
      data-testid="target-switch"
      className="flex flex-col gap-2 rounded-lg border border-night-600 bg-night-900 px-4 py-3 shadow-raise"
    >
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <label className="label-caps text-xs text-chalk-dim" htmlFor="target-select">
          Redis target
        </label>
        <span className="relative inline-flex">
          <select
            id="target-select"
            data-testid="target-select"
            value={selected}
            disabled={busy}
            onChange={(e) => onSelect?.(e.target.value)}
            className="h-9 min-w-64 cursor-pointer appearance-none rounded-sm border border-night-600 bg-night-800 pl-3 pr-9 text-md font-medium text-chalk shadow-hairline transition-colors duration-fast hover:border-chalk-faint/70 disabled:cursor-progress disabled:opacity-60"
          >
            {TARGET_PRESETS.map((p) => (
              <option key={p.id} value={p.id} className="bg-night-800 text-chalk">
                {p.label}
              </option>
            ))}
            <option value={CUSTOM_ID} className="bg-night-800 text-chalk">
              {CUSTOM_LABEL}
            </option>
          </select>
          <ChevronDown
            size={16}
            aria-hidden
            className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-chalk-dim"
          />
        </span>
        <span
          className={clsx(
            'ds-still size-2.5 shrink-0 rounded-full',
            up
              ? 'animate-live bg-turf shadow-[0_0_10px_rgb(46_226_129/0.9)]'
              : 'bg-wicket shadow-[0_0_10px_rgb(255_84_104/0.8)]',
          )}
          data-testid="target-dot"
          data-state={info ? info.state : 'unknown'}
          role="img"
          aria-label={up ? 'connected' : 'not connected'}
        />
        <span
          className="min-w-0 flex-1 truncate font-mono text-sm text-chalk-dim"
          data-testid="target-description"
        >
          {where}
        </span>
        <p className="text-xs text-chalk-dim">
          <small>{FOLLOW_COPY}</small>
        </p>
      </div>
      {selected === CUSTOM_ID ? (
        <div className="flex items-center gap-2">
          <input
            type="text"
            data-testid="target-custom"
            aria-label="Custom Redis target"
            placeholder="redis://host:port, sentinel://name@host:port,... or cluster://host:port,..."
            value={customText}
            disabled={busy}
            onChange={(e) => onCustomText?.(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') onCustomGo?.();
            }}
            spellCheck={false}
            className="h-9 min-w-0 flex-1 rounded-sm border border-night-600 bg-night-950/70 px-3 font-mono text-sm text-chalk placeholder:text-chalk-faint hover:border-chalk-faint/60 disabled:opacity-60"
          />
          <Button
            size="sm"
            disabled={busy}
            onClick={onCustomGo}
            data-testid="target-connect"
            loading={busy}
          >
            Connect
          </Button>
        </div>
      ) : null}
      {message ? (
        <p
          className="flex items-start gap-2 rounded-sm border border-wicket/40 bg-wicket/10 px-3 py-2 text-sm text-chalk"
          role="alert"
          data-testid="target-message"
        >
          <CircleAlert size={15} className="mt-0.5 shrink-0 text-wicket" aria-hidden />
          <span>{message}</span>
        </p>
      ) : null}
    </div>
  );
}

export function TargetSwitch() {
  const info = useTarget((s) => s.info);
  const redisUp = useQuest((s) => s.redisUp);
  const [custom, setCustom] = useState(false);
  const [customText, setCustomText] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    void useTarget.getState().refresh();
    // A failover changes the master without anyone pressing anything; poll while the header is on screen.
    const t = setInterval(() => void useTarget.getState().refresh(), 2000);
    return () => clearInterval(t);
  }, []);
  useEffect(() => {
    void useTarget.getState().refresh();
  }, [redisUp]);

  const selected = custom ? CUSTOM_ID : presetIdFor(info?.redisUrl);

  const go = async (url: string) => {
    setBusy(true);
    setMessage(null);
    const r = await switchTarget(url);
    if (r.ok) {
      useTarget.getState().set(r.info);
      setCustom(false);
      void useQuest.getState().refreshMirror();
    } else setMessage(r.message);
    setBusy(false);
  };

  return (
    <TargetSwitchView
      info={info}
      selected={selected}
      customText={customText}
      busy={busy}
      message={message}
      onSelect={(id) => {
        setMessage(null);
        if (id === CUSTOM_ID) {
          setCustom(true);
          if (!customText && info) setCustomText(info.redisUrl);
          return;
        }
        const preset = TARGET_PRESETS.find((p) => p.id === id);
        if (preset) void go(preset.url);
      }}
      onCustomText={setCustomText}
      onCustomGo={() => void go(customText)}
    />
  );
}
