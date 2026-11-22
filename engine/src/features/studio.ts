import { basename } from 'node:path';
import type { FastifyReply } from 'fastify';
import type { LoadedLevel, TemplateContext } from '@quest/shared';
import { runCli } from '../cli.js';
import { CommunityProgress } from '../community/progress.js';
import { playtest } from '../community/playtest.js';
import { CommunityService } from '../community/service.js';
import { validateDraft } from '../community/validate.js';
import type { LevelEventData } from '../events.js';
import { levelHints, renderLevel, type LevelIndexEntry } from '../levels.js';
import { runSetup } from '../setup.js';
import { loadVerifyConfig } from '../verify/config.js';
import { buildIdeal, idealAccess } from '../verify/ideal.js';
import { Verifier, type Answers, type VerifierDeps } from '../verify/index.js';
import type { Feature } from './index.js';

/**
 * The level studio and community levels (D-05, docs/specs/D-05-level-studio.md).
 *
 *   GET  /api/community                          packs, levels, authors and each pack's errors
 *   GET  /api/community/levels/:id               a community level, as `GET /api/levels/:id` shows a campaign one
 *   POST /api/community/levels/:id/start|brainstorm|hint|verify, GET .../ideal
 *   POST /api/studio/validate                    a draft in, the validator's positioned errors and the files out
 *   POST /api/studio/playtest                    a draft in: setup, reference, known-wrong solutions, the checks
 *
 * A community level never touches progress.json: no XP, no badges, never locked (community/progress.ts).
 */

const GUEST = { id: 'guest', name: 'Guest' } as const;

/** Verification events of the studio and of community levels stay out of the engine's event ring. */
const quietBus: VerifierDeps['bus'] = { emit() {}, subscribe: () => () => true, since: () => [] };

function isObject(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

function problem(
  reply: FastifyReply,
  code: number,
  error: string,
  message: string,
  extra: Record<string, unknown> = {},
) {
  return reply.code(code).send({ error, message, ...extra });
}

/** The number in `NN-slug.yaml`, for ordering inside a pack. */
function levelNumber(l: LoadedLevel): number {
  return Number(/^(\d+)-/.exec(basename(l.file))?.[1] ?? 0);
}

export const studio: Feature = {
  name: 'studio',
  async register({ api, deps }) {
    const { cfg, redis, bus, store } = deps;
    const community = new CommunityService(cfg.levelsDir);
    const progress = new CommunityProgress(cfg.progressDir);
    await Promise.all([community.load(), progress.load()]);

    // The verifier of the studio and of community levels: its own instance, so a play-test never waits for (or blocks)
    // a campaign verification, and its progress events are not broadcast.
    let verifierInstance: Verifier | null = null;
    const verifier = (): Verifier =>
      (verifierInstance ??= new Verifier({
        cfg: loadVerifyConfig({ progressDir: cfg.progressDir, port: cfg.port }),
        log: deps.log,
        bus: quietBus,
        redis,
      }));

    const player = () => {
      const p = store.current?.player;
      return p ? { id: p.id, name: p.name } : { ...GUEST };
    };
    const ctxFor = (levelId: string, chapterId: string): TemplateContext => ({
      player: player(),
      level: { id: levelId },
      chapter: { id: chapterId },
      env: cfg.templateEnv,
    });
    const entryCtx = (entry: LevelIndexEntry) => ctxFor(entry.level.level.id, entry.chapter.id);

    // ---- community listing ------------------------------------------------------------------
    api.get('/community', async () => {
      await community.fresh();
      const packs = community.packs.map((pack) => {
        const levels = (pack.chapter?.levels ?? [])
          .slice()
          .sort((a, b) => levelNumber(a) - levelNumber(b))
          .map((l) => {
            const lp = progress.get(l.level.id);
            return {
              id: l.level.id,
              title: l.level.title,
              mode: l.level.mode,
              number: levelNumber(l),
              author: l.level.author ?? null,
              status: lp?.status ?? 'new',
              attempts: lp?.attempts ?? 0,
            };
          });
        return {
          id: pack.id,
          title: pack.chapter?.chapter.title ?? null,
          incident: pack.chapter?.chapter.incident ?? [],
          levels,
          brokenFiles: pack.brokenFiles,
          errors: community.errorsOf(pack),
        };
      });
      return {
        packs,
        levelCount: packs.reduce((n, p) => n + p.levels.length, 0),
        errorCount: packs.reduce((n, p) => n + p.errors.length, 0),
      };
    });

    // ---- playing a community level ----------------------------------------------------------
    async function needCommunityLevel(id: string): Promise<LevelIndexEntry | null> {
      await community.fresh();
      return community.get(id) ?? null;
    }

    api.get<{ Params: { id: string } }>('/community/levels/:id', async (req, reply) => {
      const entry = await needCommunityLevel(req.params.id);
      if (!entry)
        return problem(reply, 404, 'unknown_level', `no community level ${req.params.id}`);
      const lp = progress.get(entry.level.level.id);
      const lv = entry.level.level;
      return {
        ...renderLevel(entry, entryCtx(entry), { hintsRevealed: lp?.hintsRevealed ?? 0 }),
        // The campaign screen's extra fields, filled with "not applicable".
        interview: null,
        remainingMs: null,
        slots: { own: [], active: false },
        community: { pack: entry.chapter.id, author: lv.author ?? null },
        status: lp?.status ?? 'new',
        attempts: lp?.attempts ?? 0,
        brainstormAnswer: lp?.brainstorm ?? null,
        startedAt: lp?.startedAt ?? null,
        completedAt: lp?.completedAt ?? null,
      };
    });

    api.post<{ Params: { id: string } }>('/community/levels/:id/start', async (req, reply) => {
      const entry = await needCommunityLevel(req.params.id);
      if (!entry)
        return problem(reply, 404, 'unknown_level', `no community level ${req.params.id}`);
      if (!redis.isUp)
        return problem(
          reply,
          503,
          'redis_unavailable',
          'Redis is down, so the level setup cannot run',
        );
      const setup = await runSetup(entry.level, entryCtx(entry), redis);
      const now = new Date().toISOString();
      const id = entry.level.level.id;
      const lp = await progress.update(id, (l) => {
        l.startedAt = now;
        return { ...l };
      });
      return { status: lp.status, startedAt: now, setup };
    });

    api.post<{ Params: { id: string } }>('/community/levels/:id/brainstorm', async (req, reply) => {
      const entry = await needCommunityLevel(req.params.id);
      if (!entry)
        return problem(reply, 404, 'unknown_level', `no community level ${req.params.id}`);
      const body = isObject(req.body) ? req.body : {};
      const text = typeof body.text === 'string' ? body.text.trim() : '';
      const option = entry.level.level.brainstorm.options.find((o) => o.id === body.optionId);
      if (!option)
        return problem(
          reply,
          400,
          'unknown_option',
          "optionId is not one of this level's brainstorm options",
        );
      if (text.length < 1 || text.length > 500)
        return problem(
          reply,
          400,
          'invalid_text',
          'write one line (1 to 500 characters) about why',
        );
      const at = new Date().toISOString();
      await progress.update(
        entry.level.level.id,
        (l) => void (l.brainstorm = { optionId: option.id, text, at }),
      );
      return { brainstorm: { optionId: option.id, text, at }, isReasonable: option.is_reasonable };
    });

    api.post<{ Params: { id: string } }>('/community/levels/:id/hint', async (req, reply) => {
      const entry = await needCommunityLevel(req.params.id);
      if (!entry)
        return problem(reply, 404, 'unknown_level', `no community level ${req.params.id}`);
      const hints = levelHints(entry, entryCtx(entry));
      const revealed = progress.get(entry.level.level.id)?.hintsRevealed ?? 0;
      if (revealed >= hints.length) {
        return problem(
          reply,
          409,
          'no_more_hints',
          'all hints for this level are already revealed',
          { hintsTotal: hints.length },
        );
      }
      await progress.update(entry.level.level.id, (l) => void (l.hintsRevealed = revealed + 1));
      return {
        index: revealed,
        hint: hints[revealed],
        revealed: revealed + 1,
        hintsTotal: hints.length,
      };
    });

    api.post<{ Params: { id: string } }>('/community/levels/:id/verify', async (req, reply) => {
      const entry = await needCommunityLevel(req.params.id);
      if (!entry)
        return problem(reply, 404, 'unknown_level', `no community level ${req.params.id}`);
      const body = isObject(req.body) ? req.body : {};
      const answers: Answers = {};
      if (body.answers !== undefined) {
        if (!isObject(body.answers))
          return problem(
            reply,
            400,
            'invalid_answers',
            'answers must be an object { [verifyIndex]: string | string[] }',
          );
        for (const [k, v] of Object.entries(body.answers)) {
          const ok =
            typeof v === 'string' || (Array.isArray(v) && v.every((x) => typeof x === 'string'));
          if (!/^\d+$/.test(k) || !ok)
            return problem(
              reply,
              400,
              'invalid_answers',
              `answers[${k}] must be a string or a list of strings under a numeric key`,
            );
          answers[k] = v as string | string[];
        }
      }
      const id = entry.level.level.id;
      const before = progress.get(id);
      const v = verifier();
      const done = v.begin(`community:${player().id}`); // VerifyBusyError: 409 from the engine's error handler
      let outcome;
      try {
        outcome = await v.verify(entry.level, {
          templateCtx: entryCtx(entry),
          ...(before?.startedAt ? { startedAt: before.startedAt } : {}),
          attempt: (before?.attempts ?? 0) + 1,
          answers,
        });
      } finally {
        done();
      }
      const now = new Date().toISOString();
      const result = await progress.update(id, (l) => {
        l.attempts += 1;
        if (outcome.verdict === 'right' && l.status !== 'passed') {
          l.status = 'passed';
          l.completedAt = now;
        }
        return { attempts: l.attempts, status: l.status };
      });
      const access = idealAccess(result.status, result.attempts);
      const ideal = access.allowed ? await buildIdeal(entry.level, entryCtx(entry)) : null;
      return {
        ...outcome,
        attempts: result.attempts,
        status: result.status,
        ...(ideal ? { ideal } : {}),
      };
    });

    api.get<{ Params: { id: string } }>('/community/levels/:id/ideal', async (req, reply) => {
      const entry = await needCommunityLevel(req.params.id);
      if (!entry)
        return problem(reply, 404, 'unknown_level', `no community level ${req.params.id}`);
      const lp = progress.get(entry.level.level.id);
      const access = idealAccess(lp?.status ?? 'in_progress', lp?.attempts ?? 0);
      return { ...access, ...(await buildIdeal(entry.level, entryCtx(entry))) };
    });

    // ---- the studio -------------------------------------------------------------------------
    /** The draft may be the body itself or `{ draft }`. */
    const draftOf = (body: unknown): unknown =>
      isObject(body) && isObject(body.draft) ? body.draft : body;

    api.post('/studio/validate', async (req, reply) => {
      if (!isObject(req.body))
        return problem(reply, 400, 'invalid_draft', 'send the draft as a JSON object');
      return (await validateDraft(draftOf(req.body))).result;
    });

    let playtesting = false;
    api.post('/studio/playtest', async (req, reply) => {
      if (!isObject(req.body))
        return problem(reply, 400, 'invalid_draft', 'send the draft as a JSON object');
      if (!redis.isUp)
        return problem(
          reply,
          503,
          'redis_unavailable',
          'Redis is down, so the play-test cannot run',
        );
      if (playtesting)
        return problem(reply, 409, 'playtest_in_progress', 'a play-test is already running');
      const { result, loaded, scripts } = await validateDraft(draftOf(req.body));
      if (!result.ok || !loaded) {
        return {
          passed: false,
          refused: 'The draft does not validate yet; fix the errors first.',
          validation: result,
          runs: [],
          keys: [],
        };
      }
      playtesting = true;
      const v = verifier();
      try {
        const levelId = loaded.level.id;
        const ctx = ctxFor(levelId, loaded.chapterId);
        const run = await playtest(
          {
            send: (argv) => redis.send(argv),
            cli: async (line) => runCli(redis, line),
            verify: (level, c, answers) => v.verify(level, { templateCtx: c, attempt: 1, answers }),
          },
          { level: loaded, ctx, scripts },
        );
        if (run.passed) {
          bus.emit('level.event', {
            kind: 'custom',
            name: 'studio_playtest_passed',
            data: {
              levelId,
              pack: loaded.chapterId,
              mode: loaded.level.mode,
              runs: run.runs.length,
            },
          } satisfies LevelEventData);
        }
        return { ...run, validation: result };
      } finally {
        playtesting = false;
      }
    });
  },
};
