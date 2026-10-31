export interface RunnerConfig {
  port: number;
  workspaceDir: string;
  redisUrl: string;
  databaseUrl: string;
  logDir?: string;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): RunnerConfig {
  return {
    port: Number(env.PORT ?? 4100),
    workspaceDir: env.WORKSPACE_DIR ?? '/workspace',
    redisUrl: env.REDIS_URL ?? 'redis://localhost:6379',
    databaseUrl: env.DATABASE_URL ?? 'postgres://quest:quest@localhost:5432/quest',
    logDir: env.LOG_DIR || undefined,
  };
}
