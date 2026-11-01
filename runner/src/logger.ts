import path from 'node:path';
import pino, { type Logger } from 'pino';

/** pino to stdout, plus `${logDir}/runner/runner.log` when a log dir is configured. */
export function createLogger(logDir?: string): Logger {
  if (!logDir) return pino({ name: 'runner' });
  const file = pino.destination({
    dest: path.join(logDir, 'runner', 'runner.log'),
    mkdir: true,
    sync: true,
  });
  return pino({ name: 'runner' }, pino.multistream([{ stream: process.stdout }, { stream: file }]));
}
