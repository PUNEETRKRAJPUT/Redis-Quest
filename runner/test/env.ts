import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

function dotenv(key: string): string | undefined {
  try {
    const line = readFileSync(path.join(repoRoot, '.env'), 'utf8')
      .split('\n')
      .find((l) => l.startsWith(`${key}=`));
    return line?.slice(key.length + 1).trim();
  } catch {
    return undefined;
  }
}

const val = (key: string, def: string): string => process.env[key] ?? dotenv(key) ?? def;

// Host ports come from .env (REDIS_PORT is 6390 on this Mac, where 6379 belongs to a local redis-server).
export const redisUrl = process.env.REDIS_URL ?? `redis://localhost:${val('REDIS_PORT', '6379')}`;
export const databaseUrl =
  process.env.DATABASE_URL ?? `postgres://quest:quest@localhost:${val('PG_PORT', '5432')}/quest`;
export const workspaceDir = path.join(repoRoot, 'workspace');
