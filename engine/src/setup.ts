import { commandKey, renderTemplates, SETUP_FORBIDDEN_COMMANDS, type TemplateContext } from '@quest/shared';
import type { LoadedLevel } from '@quest/shared';
import type { RedisManager } from './redis.js';

export class SetupRefusedError extends Error {}

export interface SetupResult {
  ran: number;
  /** `sql` and `script` steps need Postgres and the runner; they are not executed by the P0-06 skeleton. */
  skipped: { index: number; kind: 'sql' | 'script' }[];
}

/** Defence in depth: the schema already refuses these, the engine refuses them again at run time. */
export function assertSetupCommandAllowed(cmd: readonly string[]): void {
  const name = (cmd[0] ?? '').toUpperCase();
  if (SETUP_FORBIDDEN_COMMANDS.has(name)) throw new SetupRefusedError(`setup may not run ${name}`);
  if (cmd.some((a) => a.startsWith('game:'))) throw new SetupRefusedError(`setup may not touch game:* keys (${commandKey(cmd)})`);
}

export async function runSetup(level: LoadedLevel, ctx: TemplateContext, redis: RedisManager): Promise<SetupResult> {
  const steps = level.level.setup ?? [];
  const result: SetupResult = { ran: 0, skipped: [] };
  const rendered = renderTemplates(steps, ctx);
  // Refuse the whole list before running any of it.
  for (const step of rendered) if ('cmd' in step) assertSetupCommandAllowed(step.cmd);
  for (const [index, step] of rendered.entries()) {
    if ('cmd' in step) {
      await redis.send(step.cmd);
      result.ran += 1;
    } else {
      result.skipped.push({ index, kind: 'sql' in step ? 'sql' : 'script' });
    }
  }
  return result;
}
