import { loadConfig } from './config.js';
import { createLogger } from './logger.js';
import { buildServer } from './server.js';

const config = loadConfig();
const log = createLogger(config.logDir);
const app = buildServer(config, log);

for (const sig of ['SIGINT', 'SIGTERM'] as const) {
  process.once(sig, () => {
    void app.close().then(() => process.exit(0));
  });
}

app.listen({ port: config.port, host: '0.0.0.0' }).catch((err: unknown) => {
  log.error({ err }, 'runner failed to start');
  process.exit(1);
});
