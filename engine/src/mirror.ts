import type { Logger } from 'pino';
import { levelCounts, type ProgressFile } from './progress.js';
import type { RedisManager } from './redis.js';

export const KEY_PROGRESS = 'game:progress';
export const KEY_GIFT = 'game:welcome:gift';
export const KEY_BOOTS = 'game:engine:boots';
export const keyPlayer = (id: string) => `game:player:${id}`;
const GIFT_TTL_SECONDS = 24 * 60 * 60;

/**
 * Redis mirror of progress.json under `game:*`. The file is the source of truth; every method here
 * logs and swallows failures unless `strict` (restore), so a Redis outage never blocks a file write.
 */
export class Mirror {
  private chain: Promise<unknown> = Promise.resolve();

  constructor(
    private readonly redis: RedisManager,
    private readonly log: Logger,
  ) {}

  /** Rewrites `game:player:<id>` and `game:progress` from `p`. Queued so writes land in order. */
  write(p: ProgressFile): Promise<boolean> {
    const snapshot = structuredClone(p);
    const run = async (): Promise<boolean> => {
      try {
        await this.writeNow(snapshot);
        return true;
      } catch (err) {
        this.log.warn(
          { err: (err as Error).message },
          'mirror write failed (progress.json is still correct)',
        );
        return false;
      }
    };
    const next = this.chain.then(run, run);
    this.chain = next;
    return next;
  }

  /** Same as `write` but throws, for the explicit restore endpoint. */
  async writeStrict(p: ProgressFile): Promise<void> {
    await this.chain;
    await this.writeNow(structuredClone(p));
  }

  private async writeNow(p: ProgressFile): Promise<void> {
    const counts = levelCounts(p);
    const statuses: Record<string, string> = {};
    for (const [id, l] of Object.entries(p.levels)) statuses[id] = l.status;
    const multi = this.redis.client().multi();
    multi.hSet(keyPlayer(p.player.id), {
      name: p.player.name,
      xp: String(p.xp),
      created_at: p.player.createdAt,
      levels_passed: String(counts.passed),
      levels_in_progress: String(counts.in_progress),
      levels_available: String(counts.available),
      levels_locked: String(counts.locked),
    });
    multi.del(KEY_PROGRESS);
    if (Object.keys(statuses).length > 0) multi.hSet(KEY_PROGRESS, statuses);
    await multi.exec();
  }

  /** Sets the welcome gift once, with a 24 h TTL (Chapter 0.4 reads it). */
  async setGift(p: ProgressFile, remainingSeconds = GIFT_TTL_SECONDS): Promise<void> {
    if (remainingSeconds <= 0) return;
    try {
      await this.redis.send([
        'SET',
        KEY_GIFT,
        `welcome gift for ${p.player.name} (${p.player.id})`,
        'EX',
        String(Math.floor(remainingSeconds)),
        'NX',
      ]);
    } catch (err) {
      this.log.warn({ err: (err as Error).message }, 'welcome gift write failed');
    }
  }

  /** Whether the mirror is present and agrees with the file. */
  async status(p: ProgressFile): Promise<{
    present: boolean;
    inSync: boolean;
    expectedLevels: number;
    mirroredLevels: number;
  }> {
    const expected = Object.keys(p.levels).length;
    try {
      const hash = (await this.redis.send<Record<string, string> | unknown[]>([
        'HGETALL',
        KEY_PROGRESS,
      ])) as unknown[];
      const mirrored: Record<string, string> = {};
      for (let i = 0; i + 1 < hash.length; i += 2) mirrored[String(hash[i])] = String(hash[i + 1]);
      const n = Object.keys(mirrored).length;
      const player = (await this.redis.send<number>(['EXISTS', keyPlayer(p.player.id)])) === 1;
      const inSync =
        player &&
        n === expected &&
        Object.entries(p.levels).every(([id, l]) => mirrored[id] === l.status);
      return { present: n > 0 && player, inSync, expectedLevels: expected, mirroredLevels: n };
    } catch {
      return { present: false, inSync: false, expectedLevels: expected, mirroredLevels: 0 };
    }
  }
}
