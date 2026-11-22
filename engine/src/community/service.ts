// D-05: community levels as a second service, beside LevelService and not inside it.
//
// LevelService feeds progress.json (`orderedIds` decides which levels exist for the player), `GET /api/chapters`,
// XP, badges, locking and the "96 levels" count. A community level must take part in none of that, and the campaign
// routes in server.ts (which this task may not edit) call `levels.get(id)` and then pay XP. So a community level is
// not a flagged extra of that service: it lives here, is listed by `GET /api/community`, and is played through the
// `/api/community/levels/:id/*` routes in features/studio.ts, with its own small progress file (community-progress.ts).

import { join } from 'node:path';
import { formatLevelError, loadCommunity, type CommunityPack } from '@quest/shared';
import type { LevelIndexEntry } from '../levels.js';

export class CommunityService {
  packs: CommunityPack[] = [];
  private byId = new Map<string, LevelIndexEntry>();
  private loadedAt = 0;

  constructor(private readonly levelsDir: string) {}

  /** `<levels>/community`. The directory is mounted read-only in the stack, and need not exist. */
  get dir(): string {
    return join(this.levelsDir, 'community');
  }

  async load(): Promise<void> {
    this.packs = await loadCommunity(this.dir);
    this.byId.clear();
    let index = 0;
    for (const pack of this.packs) {
      if (!pack.chapter) continue;
      for (const level of pack.chapter.levels) {
        this.byId.set(level.level.id, { chapter: pack.chapter, level, index: index++ });
      }
    }
    this.loadedAt = Date.now();
  }

  /** Reloads when the last load is older than `maxAgeMs`, so a file dropped into the folder shows up without a restart. */
  async fresh(maxAgeMs = 1000): Promise<void> {
    if (Date.now() - this.loadedAt > maxAgeMs) await this.load();
  }

  get(id: string): LevelIndexEntry | undefined {
    return this.byId.get(id);
  }

  /** A pack's errors as `file:line:col path: message`, relative to the levels directory. */
  errorsOf(pack: CommunityPack): string[] {
    return pack.errors.map((e) => formatLevelError(e, this.levelsDir));
  }
}
