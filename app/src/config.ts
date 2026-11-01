import { hostname } from 'node:os';

export interface AppEnv {
  port: number;
  /** Stable id of this instance in metrics and `/app/health`; the container hostname under compose. */
  instance: string;
  workspaceDir: string;
  /** Used until the first successful config pull from the engine. */
  redisUrl: string;
  databaseUrl: string;
  engineUrl?: string;
  logDir?: string;
  slotTimeoutMs: number;
  configPollMs: number;
  metricsPushMs: number;
  /** Polling interval for learner files (chokidar usePolling). */
  filePollMs: number;
  /** Keep-alive requests per connection before the app asks the proxy to reconnect (0 = unlimited). */
  maxRequestsPerSocket: number;
}

const int = (v: string | undefined, dflt: number, min: number, max: number): number => {
  const n = Number(v);
  return v !== undefined && v !== '' && Number.isFinite(n) ? Math.min(max, Math.max(min, Math.trunc(n))) : dflt;
};

export function loadEnv(env: NodeJS.ProcessEnv = process.env): AppEnv {
  return {
    port: int(env.PORT, 4000, 1, 65535),
    instance: env.APP_INSTANCE || hostname(),
    workspaceDir: env.WORKSPACE_DIR ?? '/workspace',
    redisUrl: env.REDIS_URL ?? 'redis://localhost:6379',
    databaseUrl: env.DATABASE_URL ?? 'postgres://quest:quest@localhost:5432/quest',
    engineUrl: env.ENGINE_URL ? env.ENGINE_URL.replace(/\/+$/, '') : undefined,
    logDir: env.LOG_DIR || undefined,
    slotTimeoutMs: int(env.SLOT_TIMEOUT_MS, 10_000, 50, 120_000),
    // The intervals are spec values (2 s, 1 s, 1 s); the env overrides exist so tests run fast.
    configPollMs: int(env.APP_CONFIG_POLL_MS, 2000, 50, 60_000),
    metricsPushMs: int(env.APP_METRICS_PUSH_MS, 1000, 50, 60_000),
    filePollMs: int(env.APP_FILE_POLL_MS, 1000, 50, 60_000),
    // Caddy proxies to one hostname (app:4000) and reuses idle upstream connections, so with keep-alive a
    // sequential client would stick to one instance after `--scale app=2` and never see the Chapter 3
    // "you are not alone" bugs. Closing after each response makes Caddy redial, and Docker's DNS hands
    // out the instances in shuffled order. Set 0 once the proxy balances per request itself.
    maxRequestsPerSocket: int(env.APP_MAX_REQUESTS_PER_SOCKET, 1, 0, 1_000_000),
  };
}
