import path from 'node:path';
import pino, { type Logger } from 'pino';

/** The path every instance appends to; the engine tails `${LOG_DIR}/app/**`. */
export function appLogFile(logDir: string): string {
  return path.join(logDir, 'app', 'app.log');
}

/** pino to stdout plus `${LOG_DIR}/app/app.log`; every line carries the instance id. */
export function createLogger(instance: string, logDir?: string): Logger {
  const base = { name: 'app', instance };
  if (!logDir) return pino({ base });
  // sync: a learner error must be on disk before the 500 reaches the verifier, which may read the log next.
  const file = pino.destination({
    dest: appLogFile(logDir),
    mkdir: true,
    sync: true,
    append: true,
  });
  return pino({ base }, pino.multistream([{ stream: process.stdout }, { stream: file }]));
}
