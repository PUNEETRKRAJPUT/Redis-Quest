import { loadEnv } from './config.js';
import { createPool, latencyPool } from './db.js';
import { ConfigPoller, MetricsPusher, type AppConfig } from './engine.js';
import { appLogFile, createLogger } from './log.js';
import { MetricsRecorder } from './metrics.js';
import { RedisTarget } from './redis.js';
import { buildServer } from './server.js';
import { SLOTS } from './slots/registry.js';
import { SlotRuntime } from './slots/runtime.js';
import { validateRegistry } from './slots/validate.js';
import { LoopWatchdog } from './watchdog.js';

const env = loadEnv();
const log = createLogger(env.instance, env.logDir);

const problems = validateRegistry(SLOTS);
if (problems.length > 0) {
  for (const p of problems) log.fatal(`slot registry: ${p}`);
  process.exit(1);
}

// Learner code may leave promises rejecting or throw from a timer. That must never take the app down.
process.on('unhandledRejection', (reason) => {
  log.error(
    {
      err:
        reason instanceof Error
          ? { name: reason.name, message: reason.message, stack: reason.stack }
          : String(reason),
    },
    'unhandled rejection (kept running)',
  );
});
process.on('uncaughtException', (err) => {
  log.error(
    { err: { name: err.name, message: err.message, stack: err.stack } },
    'uncaught exception (kept running)',
  );
});

let dbExtraLatencyMs = 0;
const redis = new RedisTarget(env.redisUrl, log);
const rawPool = createPool(env.databaseUrl, log);
const pool = latencyPool(rawPool, () => dbExtraLatencyMs);
const watchdog = new LoopWatchdog({
  slotNames: SLOTS.map((s) => s.name),
  thresholdMs: env.slotTimeoutMs,
  logFile: env.logDir ? appLogFile(env.logDir) : undefined,
  instance: env.instance,
  log,
});
const slots = new SlotRuntime({
  registry: SLOTS,
  workspaceDir: env.workspaceDir,
  timeoutMs: env.slotTimeoutMs,
  filePollMs: env.filePollMs,
  log,
  marker: watchdog,
});
const recorder = new MetricsRecorder();

const applyConfig = async (cfg: AppConfig): Promise<void> => {
  dbExtraLatencyMs = cfg.dbExtraLatencyMs;
  slots.setActive(cfg.activeSlots);
  await redis.switchTo(cfg.target.redisUrl);
};
const poller = env.engineUrl
  ? new ConfigPoller(env.engineUrl, env.configPollMs, applyConfig, log)
  : undefined;

const app = buildServer({
  instance: env.instance,
  maxRequestsPerSocket: env.maxRequestsPerSocket,
  log,
  redis,
  pool,
  slots,
  recorder,
  lastWindow: () => pusher.lastBody,
  status: () => ({
    configEtag: poller?.etag ?? null,
    engine: poller ? (poller.engineUp ? 'up' : 'down') : 'unconfigured',
    dbExtraLatencyMs,
    slotTimeoutMs: env.slotTimeoutMs,
  }),
});
const pusher = new MetricsPusher(
  env.engineUrl,
  env.metricsPushMs,
  recorder,
  () => ({ instance: env.instance, configEtag: poller?.etag ?? null, activeSlots: slots.active }),
  log,
);

async function shutdown(): Promise<void> {
  poller?.stop();
  pusher.stop();
  await app.close().catch(() => undefined);
  await Promise.all([
    slots.close(),
    redis.close(),
    rawPool.end().catch(() => undefined),
    watchdog.close(),
  ]);
  process.exit(0);
}
for (const sig of ['SIGINT', 'SIGTERM'] as const) process.once(sig, () => void shutdown());

await slots.startWatching();
await app.listen({ port: env.port, host: '0.0.0.0' });
log.info(
  {
    port: env.port,
    engine: env.engineUrl ?? null,
    workspace: env.workspaceDir,
    slots: SLOTS.length,
    slotTimeoutMs: env.slotTimeoutMs,
  },
  'app listening',
);
poller?.start();
pusher.start();
