import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import pino, { type Logger } from 'pino';

/** Structured logs to stdout and `${logDir}/engine/engine.log`. */
export function createLogger(logDir: string): Logger {
  const streams: pino.StreamEntry[] = [{ stream: process.stdout }];
  try {
    const dir = join(logDir, 'engine');
    mkdirSync(dir, { recursive: true });
    streams.push({ stream: pino.destination({ dest: join(dir, 'engine.log'), sync: false }) });
  } catch (err) {
    // A read-only or missing log dir must not stop the game.
    console.error(`engine: cannot write ${logDir}/engine/engine.log: ${(err as Error).message}`);
  }
  return pino({ level: process.env.LOG_LEVEL ?? 'info', base: { service: 'engine' } }, pino.multistream(streams));
}
