import { loadConfig } from './config.js';
import { EventBus } from './events.js';
import { LevelService } from './levels.js';
import { createLogger } from './log.js';
import { LogTail } from './logtail.js';
import { KEY_BOOTS, Mirror } from './mirror.js';
import { MetricsStore } from './metrics.js';
import { reconcileLevels, ProgressStore } from './progress.js';
import { RedisManager } from './redis.js';
import { buildServer, type Runtime } from './server.js';
import { mkdir, rename } from 'node:fs/promises';

export type { ProgressFile, LevelProgress, LevelStatus } from './progress.js';

async function main(): Promise<void> {
  const cfg = loadConfig();
  const log = createLogger(cfg.logDir);
  const bus = new EventBus();

  const levels = new LevelService(cfg.levelsDir);
  await levels.load();
  if (levels.errors.length > 0) {
    log.error(
      { count: levels.errors.length },
      'level files have errors; /api will answer 503 until they are fixed',
    );
    for (const e of levels.errors) log.error(e);
  } else {
    log.info(
      { chapters: levels.chapters.length, levels: levels.orderedIds.length },
      'levels loaded',
    );
  }

  const store = new ProgressStore(cfg.progressDir);
  const loaded = await store.load();
  if (loaded.kind === 'invalid') {
    // Never overwrite a save file we cannot read: keep it aside and start as a first run.
    const aside = `${store.file}.corrupt-${Date.now()}`;
    await rename(store.file, aside);
    log.error(
      { reason: loaded.reason, movedTo: aside },
      'progress.json is unreadable; moved aside, starting a new save',
    );
  }
  if (
    store.current &&
    levels.errors.length === 0 &&
    reconcileLevels(store.current, levels.orderedIds)
  ) {
    await store.update(() => undefined);
  }
  await mkdir(cfg.workspaceDir, { recursive: true });

  const runtime: Runtime = {
    redisUrl: store.current?.target.redisUrl ?? cfg.redisUrl,
    activeSlots: store.current?.activeSlots ?? [],
    dbExtraLatencyMs: 0,
    boots: null,
  };

  const redis = new RedisManager(log, bus);
  const mirror = new Mirror(redis, log);
  // Count this boot as soon as Redis is reachable; never blocks startup and retries on every reconnect until it lands.
  let giftChecked = false;
  redis.onUp(() => {
    // The welcome gift must exist whenever the game runs (level 0.4 reads its TTL): re-set it if missing, once per boot.
    if (!giftChecked && store.current) {
      giftChecked = true;
      void mirror.setGift(store.current);
    }
    if (runtime.boots !== null) return;
    redis.send<number>(['INCR', KEY_BOOTS]).then(
      (n) => {
        runtime.boots = Number(n);
        log.info({ boots: runtime.boots }, 'boot counted');
      },
      (err: Error) => log.warn({ err: err.message }, 'boot counter write failed'),
    );
  });
  await redis.connect(runtime.redisUrl);

  const logtail = new LogTail(cfg.logDir, bus);
  await logtail.start();
  const metrics = new MetricsStore();
  const app = await buildServer({
    cfg,
    log,
    bus,
    store,
    redis,
    mirror,
    levels,
    logtail,
    metrics,
    runtime,
  });

  const tick = setInterval(() => {
    const t = metrics.tick();
    if (t) bus.emit('metrics.tick', t);
  }, 1000);
  tick.unref();

  await app.listen({ host: '0.0.0.0', port: cfg.port });
  log.info(
    { port: cfg.port, redis: runtime.redisUrl, dev: cfg.dev, levelsDir: cfg.levelsDir },
    'engine listening',
  );

  const stop = async (signal: string) => {
    log.info({ signal }, 'engine stopping');
    clearInterval(tick);
    logtail.stop();
    redis.close();
    await app.close();
    process.exit(0);
  };
  process.on('SIGTERM', () => void stop('SIGTERM'));
  process.on('SIGINT', () => void stop('SIGINT'));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
