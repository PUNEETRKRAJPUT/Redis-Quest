import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/** Settings the verifier reads from the environment (all optional). */
export interface VerifyConfig {
  runnerUrl: string;
  /** Base of the app as the load generator sees it, e.g. http://proxy:3000/app. */
  appUrl: string;
  scenariosDir: string;
  /** Where baselines live: `${PROGRESS_DIR}/baselines`. */
  baselinesDir: string;
  /** Loopback base of this engine's own API, used to switch slots through PUT /api/slots. */
  engineApi: string;
  caps: LoadCaps;
  /** Test knob: caps how long an `event` verifier waits for a new event (default: the level's timeoutMs). */
  maxEventWaitMs: number | null;
}

export interface LoadCaps {
  maxConnections: number;
  maxDurationSec: number;
  lowPower: boolean;
}

function positiveInt(v: string | undefined, def: number): number {
  const n = Number(v);
  return v !== undefined && v !== '' && Number.isInteger(n) && n > 0 ? n : def;
}

/** LOAD_MAX_CONNECTIONS (200), LOAD_MAX_DURATION_SEC (30); LOW_POWER=1 halves both. */
export function loadCaps(env: NodeJS.ProcessEnv): LoadCaps {
  const lowPower = env.LOW_POWER === '1';
  const div = lowPower ? 2 : 1;
  return {
    maxConnections: Math.max(1, Math.floor(positiveInt(env.LOAD_MAX_CONNECTIONS, 200) / div)),
    maxDurationSec: Math.max(1, Math.floor(positiveInt(env.LOAD_MAX_DURATION_SEC, 30) / div)),
    lowPower,
  };
}

export function loadVerifyConfig(
  opts: { progressDir: string; port: number },
  env: NodeJS.ProcessEnv = process.env,
): VerifyConfig {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..'); // <root>/engine/dist/verify
  const wait = env.VERIFY_MAX_EVENT_WAIT_MS;
  return {
    runnerUrl: env.RUNNER_URL ?? 'http://runner:4100',
    appUrl: env.APP_URL ?? 'http://proxy:3000/app',
    scenariosDir: resolve(env.SCENARIOS_DIR ?? resolve(root, 'scenarios')),
    baselinesDir: resolve(opts.progressDir, 'baselines'),
    engineApi: `http://127.0.0.1:${opts.port}/api`,
    caps: loadCaps(env),
    maxEventWaitMs:
      wait !== undefined && wait !== '' && Number.isFinite(Number(wait))
        ? Math.max(0, Number(wait))
        : null,
  };
}
