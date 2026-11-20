import {
  buildFixture,
  cardInfo,
  loadDeck,
  MACHINE_NOTE,
  parseSeed,
  seedForDate,
  type Deck,
} from '@quest/shared';
import { loadVerifyConfig } from '../verify/config.js';
import { restoreMaxmemory } from '../matchday/changes.js';
import { FileJournal, ResultsStore } from '../matchday/files.js';
import { injectLoadPort } from '../matchday/load-port.js';
import { incidentsDir } from '../matchday/paths.js';
import { MatchRefusedError, MatchRunner, publicFixture } from '../matchday/runner.js';
import type { MatchdayOverview } from '../matchday/types.js';
import type { Feature } from './index.js';

/**
 * Match Day: the incident deck and the seeded survival run (docs/specs/D-09-match-day.md).
 *   GET  /api/matchday[?seed=N]   today's fixture (or seed N's), the best results, whether a match can start now
 *   POST /api/matchday/start      { seed? } starts a match; 409 while a match, a level check or a traffic run is going
 *   GET  /api/matchday/status     the live match, or the last one
 *   POST /api/matchday/stop       ends the running match early (everything is put back)
 * Progress is pushed as level events: matchday_started, matchday_card, matchday_over_started, matchday_over,
 * matchday_finished. Results live in `matchday-results.json` in the progress folder, not in progress.json.
 */
export const matchday: Feature = {
  name: 'matchday',
  register({ api, deps }) {
    const { cfg, redis, bus, log } = deps;
    const dir = incidentsDir();
    const results = new ResultsStore(cfg.progressDir);
    const journal = new FileJournal(cfg.progressDir);
    const load = injectLoadPort(api);
    const caps = loadVerifyConfig({ progressDir: cfg.progressDir, port: cfg.port }).caps;
    const readDeck = (): Promise<Deck> => loadDeck(dir);

    const runner = new MatchRunner({
      redis,
      load,
      bus,
      journal,
      results,
      loadDeck: readDeck,
      log,
    });

    // If the engine was cut off while a card had lowered maxmemory, the journal still holds the real value:
    // put it back as soon as Redis answers, unless a match is being played right now.
    const restoreLeftover = () => {
      if (runner.busy) return;
      restoreMaxmemory(redis, journal).then(
        (done) => done && log.warn('matchday: put maxmemory back after an interrupted match'),
        (err: Error) =>
          log.warn({ err: err.message }, 'matchday: could not put maxmemory back yet'),
      );
    };
    redis.onUp(restoreLeftover);
    if (redis.isUp) restoreLeftover();

    api.get<{ Querystring: { seed?: string } }>('/matchday', async (req, reply) => {
      const today = new Date();
      let seed = seedForDate(today);
      if (req.query.seed !== undefined) {
        const s = parseSeed(req.query.seed);
        if (s === null)
          return reply.code(400).send({
            error: 'invalid_seed',
            message: 'seed must be a whole number from 1 to 2147483647',
          });
        seed = s;
      }
      const deck = await readDeck();
      const fixture = buildFixture(seed, deck.cards.map(cardInfo));
      const all = await results.read();
      let reason: string | null = null;
      if (runner.busy) reason = 'a match is being played';
      else if (!redis.isUp) reason = 'Redis is not reachable right now';
      else if (redis.kind !== 'single') reason = 'Match Day plays on the single-node Redis target';
      else if (deck.cards.length === 0) reason = 'the incident deck could not be loaded';
      else if ((await load.status()).running) reason = 'a traffic run is going';
      const overview: MatchdayOverview = {
        today: { seed: seedForDate(today), date: today.toISOString().slice(0, 10) },
        fixture: publicFixture(fixture),
        results: all,
        bestForSeed: all.bySeed[String(seed)] ?? null,
        canStart: { ok: reason === null, reason },
        deckErrors: deck.errors.map((e) => `${e.file}: ${e.message}`),
        machineNote: MACHINE_NOTE,
        caps: { ...caps },
      };
      return overview;
    });

    api.post('/matchday/start', async (req, reply) => {
      const body =
        req.body && typeof req.body === 'object' ? (req.body as Record<string, unknown>) : {};
      let seed = seedForDate(new Date());
      if (body.seed !== undefined) {
        const s = parseSeed(body.seed);
        if (s === null)
          return reply.code(400).send({
            error: 'invalid_seed',
            message: 'seed must be a whole number from 1 to 2147483647',
          });
        seed = s;
      }
      try {
        return reply.code(202).send(await runner.start(seed));
      } catch (err) {
        if (err instanceof MatchRefusedError)
          return reply.code(err.status).send({ error: err.code, message: err.message });
        throw err;
      }
    });

    api.get('/matchday/status', async () => runner.status());
    api.post('/matchday/stop', async () => runner.stop());

    log.info({ incidents: dir }, 'matchday: incident deck folder');
  },
};
