// What the HUD says about the stack, and when the "rain delay" strip shows, as pure functions.
import type { Boot, WsState } from '../store';

export const STACK_COMMAND = './scripts/start';
export const REDIS_COMMAND = 'docker compose start redis';

/** `stack`: the engine or the socket is gone. `redis`: the engine answers but Redis does not. */
export type RainReason = 'stack' | 'redis' | null;

export function rainReason(i: {
  boot: Boot;
  ws: WsState;
  redisUp: boolean | null;
  /** next/offline's signal: the browser's own network, as an extra hint. */
  offline: boolean;
}): RainReason {
  if (i.boot !== 'ready') return null;
  if (i.ws !== 'open' || i.offline) return 'stack';
  if (i.redisUp === false) return 'redis';
  return null;
}

export interface StackLight {
  live: boolean;
  /** The words next to the light. `conn-state` shows exactly these. */
  text: 'live' | 'reconnecting' | 'redis down';
  /** The light's accessible name. */
  label: string;
}

export function stackLight(ws: WsState, redisUp: boolean | null): StackLight {
  const live = ws === 'open' && redisUp !== false;
  return {
    live,
    text: ws !== 'open' ? 'reconnecting' : redisUp === false ? 'redis down' : 'live',
    label: live
      ? 'Connected to the engine and Redis'
      : ws !== 'open'
        ? 'Reconnecting to the engine'
        : 'Redis is down',
  };
}

/** A blip shorter than this never shows the strip (the socket needs a moment on every page load). */
export const RAIN_SHOW_DELAY_MS = 1200;
/** How long "Play resumes" stays after the stack comes back. */
export const RESUME_MS = 4000;
