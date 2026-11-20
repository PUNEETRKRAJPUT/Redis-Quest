// D-05: what a player has done in community levels. A small file of its own beside progress.json, so a community level
// never touches XP, badges or locking, and a broken file here can never cost the player their campaign.

import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { writeFileAtomic } from '../progress.js';

export interface CommunityLevelProgress {
  status: 'in_progress' | 'passed';
  attempts: number;
  hintsRevealed: number;
  startedAt?: string;
  completedAt?: string;
  brainstorm?: { optionId: string; text: string; at: string };
}

export const COMMUNITY_PROGRESS_FILE = 'community-progress.json';

function isLevelProgress(v: unknown): v is CommunityLevelProgress {
  if (!v || typeof v !== 'object') return false;
  const o = v as Record<string, unknown>;
  return (
    (o.status === 'in_progress' || o.status === 'passed') &&
    typeof o.attempts === 'number' &&
    typeof o.hintsRevealed === 'number'
  );
}

export class CommunityProgress {
  private levels: Record<string, CommunityLevelProgress> = {};
  private queue: Promise<unknown> = Promise.resolve();
  private readonly file: string;

  constructor(progressDir: string) {
    this.file = join(progressDir, COMMUNITY_PROGRESS_FILE);
  }

  /** Reads the file; a missing or unreadable one is an empty record (nothing is lost that mattered to the campaign). */
  async load(): Promise<void> {
    try {
      const parsed = JSON.parse(await readFile(this.file, 'utf8')) as {
        levels?: Record<string, unknown>;
      };
      const out: Record<string, CommunityLevelProgress> = {};
      for (const [id, v] of Object.entries(parsed.levels ?? {}))
        if (isLevelProgress(v)) out[id] = v;
      this.levels = out;
    } catch {
      this.levels = {};
    }
  }

  get(id: string): CommunityLevelProgress | undefined {
    return this.levels[id];
  }

  /** Applies `fn` to the level's record (created as in progress when absent) and writes the file. Writes run one at a time. */
  update<T>(id: string, fn: (lp: CommunityLevelProgress) => T): Promise<T> {
    const run = async (): Promise<T> => {
      const lp = this.levels[id] ?? {
        status: 'in_progress' as const,
        attempts: 0,
        hintsRevealed: 0,
      };
      const out = fn(lp);
      this.levels[id] = lp;
      await writeFileAtomic(this.file, `${JSON.stringify({ levels: this.levels }, null, 2)}\n`);
      return out;
    };
    const next = this.queue.then(run, run);
    this.queue = next.catch(() => undefined);
    return next;
  }
}
