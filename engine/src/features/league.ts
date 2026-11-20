import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  LEAGUE_DB,
  describeCheck,
  formatLevelError,
  loadLeague,
  openScratch,
  parseEntry,
  rankAttempt,
  rankBoard,
  scoreEntry,
  type BoardRow,
  type LoadedHole,
  type RunCommand,
  type ScoreResult,
} from '@quest/shared';
import type { FastifyReply } from 'fastify';
import type { Feature, FeatureContext } from './index.js';

/**
 * The Economy League (docs/specs/D-07-economy-league.md): the holes, scoring an attempt, the committed board.
 *
 *   GET  /api/league        the holes, and every committed entry's score
 *   POST /api/league/score  { hole, entry } -> the attempt's score and where it would rank
 *
 * Scoring never uses the engine's own Redis connection: a SELECT on it would move every other caller into the scratch
 * database. Each run opens a connection of its own on logical database 7 (never 0, where `game:*` lives), and the
 * runs go one at a time because they share that database.
 */

/** The attempt is scored under this handle; it is never written to disk. */
const ATTEMPT_HANDLE = 'you';
const ATTEMPT_FILE = 'your attempt';

/** `<root>/golf`. In the image that is /srv/golf (the Dockerfile has to copy it; see docs/handoffs/D-07.md). */
function defaultGolfDir(): string {
  if (process.env.GOLF_DIR) return resolve(process.env.GOLF_DIR);
  return resolve(dirname(fileURLToPath(import.meta.url)), '../../..', 'golf');
}

export interface LeagueRedis {
  /** `single`, `sentinel` or `cluster`; null when the target did not parse. */
  kind: string | null;
  isUp: boolean;
  /** The target URL when it is a single node. */
  singleUrl: string | undefined;
  /** `host:port` of the master when the target is Sentinel and it is known. */
  master: string | undefined;
}

export interface LeagueOptions {
  golfDir?: () => string;
  open?: typeof openScratch;
  redis?: (ctx: FeatureContext) => LeagueRedis;
}

type Committed = { rows: BoardRow[]; failed: { handle: string; message: string }[] };

const text = (argv: readonly string[]): string =>
  argv.map((a) => (a === '' || /[\s"']/.test(a) ? JSON.stringify(a) : a)).join(' ');

function refusal(
  res: FastifyReply,
  status: number,
  error: string,
  message: string,
  extra: object = {},
) {
  return res.code(status).send({ error, message, ...extra });
}

export function createLeague(opts: LeagueOptions = {}): Feature {
  const golfDir = opts.golfDir ?? defaultGolfDir;
  const open = opts.open ?? openScratch;
  const redisOf =
    opts.redis ??
    ((ctx: FeatureContext): LeagueRedis => {
      const r = ctx.deps.redis;
      return {
        kind: r.kind,
        isUp: r.isUp,
        singleUrl: r.target?.kind === 'single' ? r.target.url : undefined,
        master: r.targetInfo().master,
      };
    });

  return {
    name: 'league',
    register(ctx) {
      const { api } = ctx;

      // One scoring run at a time: they all use database 7 of the same server.
      let chain: Promise<unknown> = Promise.resolve();
      const exclusive = <T>(fn: () => Promise<T>): Promise<T> => {
        const next = chain.then(fn, fn);
        chain = next.catch(() => undefined);
        return next;
      };

      // The committed board, kept until a file or the target changes.
      let cache: { key: string; board: Map<string, Committed> } | null = null;

      /** Why scoring cannot run on this target right now, or the one-node URL to score on. */
      function where(): { url: string } | { status: number; error: string; message: string } {
        const r = redisOf(ctx);
        if (r.kind === 'cluster') {
          return {
            status: 409,
            error: 'cluster',
            message:
              'The league scores in a logical database of its own, and a cluster has only one database. Switch the target to a single node or Sentinel to score an attempt; the committed scores below are still shown.',
          };
        }
        if (!r.isUp) {
          return {
            status: 503,
            error: 'redis_down',
            message: 'Redis is not reachable right now, so nothing can be scored.',
          };
        }
        if (r.kind === 'sentinel') {
          if (!r.master) {
            return {
              status: 503,
              error: 'redis_down',
              message: 'Sentinel has not named a master yet.',
            };
          }
          return { url: `redis://${r.master}` };
        }
        if (!r.singleUrl) {
          return { status: 503, error: 'redis_down', message: 'There is no usable Redis target.' };
        }
        return { url: r.singleUrl };
      }

      async function scoreCommitted(run: RunCommand, holes: readonly LoadedHole[]) {
        const board = new Map<string, Committed>();
        for (const h of holes) {
          const c: Committed = { rows: [], failed: [] };
          for (const entry of h.entries) {
            const r = await scoreEntry({ id: h.id, hole: h.hole }, entry, run);
            if (r.ok) {
              c.rows.push({
                handle: entry.handle,
                commands: r.commands,
                bytes: r.bytes,
                chars: r.chars,
              });
            } else {
              c.failed.push({ handle: entry.handle, message: r.message });
            }
          }
          board.set(h.id, c);
        }
        return board;
      }

      const signature = (holes: readonly LoadedHole[], url: string): string =>
        JSON.stringify([url, holes.map((h) => [h.id, h.hole, h.entries])]);

      /** Opens a scratch connection, runs `fn`, closes it. */
      async function withScratch<T>(url: string, fn: (run: RunCommand) => Promise<T>): Promise<T> {
        const scratch = await open(url, LEAGUE_DB);
        try {
          return await fn(scratch.run);
        } finally {
          await scratch.close();
        }
      }

      async function boardFor(holes: readonly LoadedHole[], run: RunCommand, url: string) {
        const key = signature(holes, url);
        if (cache?.key === key) return cache.board;
        const board = await scoreCommitted(run, holes);
        cache = { key, board };
        return board;
      }

      const view = (h: LoadedHole) => ({
        id: h.id,
        title: h.hole.title,
        task: h.hole.task,
        par: h.hole.par,
        setup: (h.hole.setup ?? []).map((s) => text(s.cmd)),
        checks: h.hole.checks.map(describeCheck),
      });

      api.get('/league', async () => {
        const dir = golfDir();
        const { holes, errors } = await loadLeague(dir);
        const problems = errors.map((e) => formatLevelError(e, resolve(dir, '..')));
        const w = where();
        let board: Map<string, Committed> | null = null;
        let unscored: string | null = null;
        if ('url' in w) {
          try {
            board = await exclusive(() => withScratch(w.url, (run) => boardFor(holes, run, w.url)));
          } catch (err) {
            unscored = `Scoring could not run: ${err instanceof Error ? err.message : String(err)}`;
          }
        } else {
          unscored = w.message;
        }
        return {
          available: holes.length > 0,
          db: LEAGUE_DB,
          scored: board !== null,
          ...(unscored ? { unscored } : {}),
          problems,
          holes: holes.map((h) => {
            const c = board?.get(h.id);
            return {
              ...view(h),
              entries: c
                ? rankBoard(c.rows).map((r) => ({ ...r, underPar: h.hole.par - r.commands }))
                : h.entries.map((e) => ({ handle: e.handle, commands: e.commands.length })),
              failed: c?.failed ?? [],
            };
          }),
        };
      });

      api.post<{ Body: { hole?: unknown; entry?: unknown } }>('/league/score', async (req, res) => {
        const body = req.body ?? {};
        if (typeof body.hole !== 'string' || typeof body.entry !== 'string') {
          return refusal(
            res,
            400,
            'bad_request',
            'Send { "hole": "<hole id>", "entry": "<commands, one per line>" }.',
          );
        }
        const { holes } = await loadLeague(golfDir());
        const h = holes.find((x) => x.id === body.hole);
        if (!h) return refusal(res, 404, 'unknown_hole', `There is no hole called ${body.hole}.`);

        const parsed = parseEntry(ATTEMPT_HANDLE, body.entry, ATTEMPT_FILE);
        if (!parsed.entry) {
          return refusal(res, 400, 'invalid_entry', 'The entry cannot be scored as written.', {
            problems: parsed.errors.map((e) => ({ line: e.line, col: e.col, message: e.message })),
          });
        }
        const attempt = parsed.entry;

        const w = where();
        if (!('url' in w)) return refusal(res, w.status, w.error, w.message);

        try {
          return await exclusive(() =>
            withScratch(w.url, async (run) => {
              const board = await boardFor(holes, run, w.url);
              const result: ScoreResult = await scoreEntry(
                { id: h.id, hole: h.hole },
                attempt,
                run,
              );
              const rows = board.get(h.id)?.rows ?? [];
              return {
                result,
                rank: result.ok ? rankAttempt(result, rows) : null,
                committed: rows.length,
              };
            }),
          );
        } catch (err) {
          return refusal(
            res,
            502,
            'scoring_failed',
            `Scoring could not run: ${err instanceof Error ? err.message : String(err)}`,
          );
        }
      });
    },
  };
}

export const league: Feature = createLeague();
