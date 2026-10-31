import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export interface Config {
  port: number;
  redisUrl: string;
  databaseUrl: string;
  logDir: string;
  progressDir: string;
  workspaceDir: string;
  levelsDir: string;
  uiDistDir: string;
  dev: boolean;
  /** Values a level may read with {{env.NAME}}. Only these names are exposed. */
  templateEnv: Record<string, string>;
}

const TEMPLATE_ENV_NAMES = ['REDIS_PORT', 'PROXY_PORT', 'INSIGHT_PORT', 'PG_PORT'];

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const here = dirname(fileURLToPath(import.meta.url)); // <root>/engine/dist
  const root = resolve(here, '../..');
  const templateEnv: Record<string, string> = {};
  for (const name of TEMPLATE_ENV_NAMES) {
    const v = env[name];
    if (v !== undefined && v !== '') templateEnv[name] = v;
  }
  return {
    port: Number(env.PORT ?? 4200),
    redisUrl: env.REDIS_URL ?? 'redis://127.0.0.1:6379',
    databaseUrl: env.DATABASE_URL ?? 'postgres://quest:quest@postgres:5432/quest',
    logDir: resolve(env.LOG_DIR ?? resolve(root, 'logs')),
    progressDir: resolve(env.PROGRESS_DIR ?? resolve(root, '.progress')),
    workspaceDir: resolve(env.WORKSPACE_DIR ?? resolve(root, 'workspace')),
    levelsDir: resolve(env.LEVELS_DIR ?? resolve(root, 'levels')),
    uiDistDir: resolve(env.UI_DIST_DIR ?? resolve(root, 'ui/dist')),
    dev: env.ENGINE_DEV === '1',
    templateEnv,
  };
}
