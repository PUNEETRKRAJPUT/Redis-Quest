import { readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadCommunity, type LoadedLevel } from '@quest/shared';
import type { Snapshot } from '../command-docs.js';
import { boardNames, buildBoard } from '../coverage/board.js';
import { parseCast, parseContributors, type CastMember } from '../coverage/contributors.js';
import { addLevelUsage, type Usage } from '../coverage/usage.js';
import type { Feature } from './index.js';

/**
 * The wanted-commands board and the credits' data (D-06, docs/specs/D-06-your-turn.md).
 *
 *   GET /api/coverage   every top-level command of the running server, grouped by the server's own group, each marked
 *                       taught or untaught by what the campaign's and the community's levels use (coverage/usage.ts).
 *                       `{ available: false, reason }` while the engine has no command-docs snapshot (Redis down).
 *   GET /api/credits    the cast (fiction/cast.json) and the people in CONTRIBUTORS.md, both read from the repository
 *                       root; a file that is not there is reported as unavailable, never as an empty list.
 *
 * The community's authors are not here: the credits screen reads them from GET /api/community.
 */

/** A scan of every level file is a hundred small reads; a dropped-in community level shows up within this long. */
const USAGE_MAX_AGE_MS = 5000;

/** The repository root: `<root>/engine/dist/features/coverage.js` in the image and on the Mac. */
export function defaultRootDir(): string {
  return resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
}

async function readOptional(path: string): Promise<string | null> {
  try {
    return await readFile(path, 'utf8');
  } catch {
    return null;
  }
}

export function createCoverage(opts: { rootDir?: string } = {}): Feature {
  const rootDir = opts.rootDir ?? defaultRootDir();
  return {
    name: 'coverage',
    register({ api, deps }) {
      let cached: { snap: Snapshot; at: number; usage: Usage; levels: number } | null = null;

      async function usageFor(snap: Snapshot): Promise<{ usage: Usage; levels: number }> {
        if (cached && cached.snap === snap && Date.now() - cached.at < USAGE_MAX_AGE_MS)
          return cached;
        const known = boardNames(snap);
        const loaded: LoadedLevel[] = deps.levels.chapters.flatMap((c) => c.levels);
        // The community folder is read fresh, like GET /api/community: a level dropped in counts without a restart.
        const packs = await loadCommunity(join(deps.cfg.levelsDir, 'community')).catch(() => []);
        for (const pack of packs) if (pack.chapter) loaded.push(...pack.chapter.levels);
        const usage: Usage = new Map();
        for (const l of loaded) await addLevelUsage(usage, l, known);
        cached = { snap, at: Date.now(), usage, levels: loaded.length };
        return cached;
      }

      api.get('/coverage', async () => {
        const snap = deps.commandDocs?.snapshot() ?? null;
        if (!snap) {
          return {
            available: false,
            reason:
              'The engine has no command list from Redis right now (Redis is down or still starting), so there is nothing honest to show. The board returns when Redis is up.',
          };
        }
        const { usage, levels } = await usageFor(snap);
        return { ...buildBoard(snap, usage), levelsRead: levels };
      });

      api.get('/credits', async () => {
        const [castText, contribText] = await Promise.all([
          readOptional(join(rootDir, 'fiction', 'cast.json')),
          readOptional(join(rootDir, 'CONTRIBUTORS.md')),
        ]);
        let cast: CastMember[] | null = null;
        if (castText !== null) {
          try {
            cast = parseCast(JSON.parse(castText));
          } catch {
            cast = null;
          }
        }
        return {
          cast,
          contributors: contribText === null ? null : parseContributors(contribText),
        };
      });
    },
  };
}

export const coverage: Feature = createCoverage();
