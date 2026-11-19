// Turns engine events into one-line toasts, and keeps a burst of the same event from becoming a storm.
import type { Cue } from '@/design/sound';
import type { ToastTone } from '@/design/toast';
import type { LevelEventMsg } from '../types';

export interface ToastSpec {
  /** Repeats with the same key inside the collapse window are dropped. */
  key: string;
  title: string;
  description?: string;
  tone: ToastTone;
  cue?: Cue;
}

/** "cache_warmed" becomes "Cache warmed". */
export function humanize(name: string): string {
  const s = name.replace(/[_-]+/g, ' ').trim();
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
}

// Plumbing the game itself sends: not news for the player.
const QUIET = new Set(['ui_connected', 'cli_ping', 'level_started']);
const VERIFY_PREFIX = 'verify_';

const asObj = (v: unknown): Record<string, unknown> =>
  v && typeof v === 'object' ? (v as Record<string, unknown>) : {};
const plural = (n: number, one: string, many: string) => (n === 1 ? one : many);

/** The toast for an engine event, or null when the player does not need to hear about it. */
export function describeEvent(e: Pick<LevelEventMsg, 'kind' | 'name' | 'data'>): ToastSpec | null {
  const d = asObj(e.data);
  switch (e.kind) {
    // The rain-delay strip already says when Redis goes and comes back.
    case 'redis_disconnect':
    case 'redis_reconnect':
      return null;
    case 'service_scaled': {
      const n = typeof d.instances === 'number' ? d.instances : null;
      if (n === null) return { key: 'service_scaled', title: 'The app was scaled', tone: 'info' };
      return {
        key: 'service_scaled',
        title: `The app now runs ${n} ${plural(n, 'copy', 'copies')}`,
        tone: 'info',
      };
    }
    case 'key_expired':
      return { key: 'key_expired', title: 'A key expired', tone: 'info' };
    case 'channel_message':
      return { key: 'channel_message', title: 'A message arrived on a channel', tone: 'info' };
    case 'custom':
      break;
    default:
      return null;
  }
  const name = e.name ?? '';
  if (!name || QUIET.has(name)) return null;
  // The engine reports its own check as custom `verify_*` events (engine/src/verify/events.ts). The level screen
  // already shows that progress as the third-umpire review, so a toast per step would only pile up on top of it.
  if (name.startsWith(VERIFY_PREFIX)) return null;
  switch (name) {
    case 'progress_restored':
      return { key: name, title: 'Save file restored', tone: 'success' };
    case 'portfolio_written':
      return { key: name, title: 'Portfolio written', tone: 'success' };
    case 'redis_busy':
      return { key: name, title: 'Redis is busy running a script', tone: 'warn' };
    case 'script_killed':
      return { key: name, title: 'The script was stopped', tone: 'info' };
    case 'redis_target_changed':
      return {
        key: name,
        title:
          typeof d.kind === 'string'
            ? `Redis target switched to ${d.kind}`
            : 'Redis target changed',
        tone: 'info',
      };
    case 'load_started':
      return { key: name, title: 'Load test started', tone: 'info' };
    case 'load_finished':
      return { key: name, title: 'Load test finished', tone: 'success' };
    case 'load_failed':
      return { key: name, title: 'Load test failed', tone: 'error' };
    case 'sentinel_failover':
      return { key: name, title: 'Sentinel promoted a new primary', tone: 'warn' };
    default:
      return { key: `custom:${name}`, title: humanize(name), tone: 'info' };
  }
}

const DANGER_NOTE: Record<string, string> = {
  KEYS: 'KEYS blocks Redis while it scans every key. Use it for debugging only.',
  FLUSHALL: 'Every key was deleted. Your progress file on your Mac is safe.',
  FLUSHDB: 'Every key in this database was deleted. Your progress file on your Mac is safe.',
  MONITOR: 'Fine to try here. Avoid it on a system real people use.',
  DEBUG: 'Fine to try here. Avoid it on a system real people use.',
};

/** The warning for a command the engine flagged as dangerous. */
export function describeDanger(command: string): ToastSpec {
  const c = command.toUpperCase();
  return {
    key: `danger:${c}`,
    title: `${c} just ran`,
    description: DANGER_NOTE[c] ?? 'That command can hurt a real system.',
    tone: 'warn',
    cue: 'pager',
  };
}

/** `allow(key, now)` is true at most once per key per window. */
export function createCollapser(windowMs = 2000) {
  const last = new Map<string, number>();
  return (key: string, now: number): boolean => {
    const before = last.get(key);
    if (before !== undefined && now - before < windowMs) return false;
    last.set(key, now);
    if (last.size > 64) for (const [k, t] of last) if (now - t >= windowMs) last.delete(k);
    return true;
  };
}
