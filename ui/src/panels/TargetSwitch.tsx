// E-03: which Redis the game talks to. A select in the terminal's header with the presets Chapter 5 walks through
// (single node, no persistence, replica, Sentinel, cluster) and a custom string. Choosing one asks the engine
// (`PUT /api/target`); the app and the runner follow the engine within about two seconds.
import { useEffect, useState } from 'react';
import { create } from 'zustand';
import { api } from '../api';
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
    <div className="target-switch" data-testid="target-switch">
      <div className="target-row">
        <label className="target-label" htmlFor="target-select">
          Redis target
        </label>
        <select
          id="target-select"
          data-testid="target-select"
          value={selected}
          disabled={busy}
          onChange={(e) => onSelect?.(e.target.value)}
        >
          {TARGET_PRESETS.map((p) => (
            <option key={p.id} value={p.id}>
              {p.label}
            </option>
          ))}
          <option value={CUSTOM_ID}>{CUSTOM_LABEL}</option>
        </select>
        <span
          className={up ? 'target-dot up' : 'target-dot down'}
          data-testid="target-dot"
          data-state={info ? info.state : 'unknown'}
          role="img"
          aria-label={up ? 'connected' : 'not connected'}
        />
        <span className="target-desc" data-testid="target-description">
          {where}
        </span>
      </div>
      {selected === CUSTOM_ID ? (
        <div className="target-row">
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
          />
          <button type="button" disabled={busy} onClick={onCustomGo} data-testid="target-connect">
            Connect
          </button>
        </div>
      ) : null}
      {message ? (
        <p className="target-msg" role="alert" data-testid="target-message">
          {message}
        </p>
      ) : null}
      <p className="target-note">
        <small>{FOLLOW_COPY}</small>
      </p>
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
