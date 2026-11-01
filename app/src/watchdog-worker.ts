// Runs in a worker thread, so it keeps running while the main thread is stuck in learner code.
import { appendFileSync, mkdirSync, writeSync } from 'node:fs';
import path from 'node:path';
import { workerData } from 'node:worker_threads';

interface Data {
  shared: Int32Array;
  slotNames: string[];
  thresholdMs: number;
  logFile?: string;
  instance: string;
}

const d = workerData as Data;
let lastBeat = Atomics.load(d.shared, 0);
let lastChange = Date.now();
let reported = false;

function write(level: number, msg: string, extra: Record<string, unknown>): void {
  // pino's line shape, so the engine's log tail and the UI treat it like any other app line.
  const line =
    JSON.stringify({
      level,
      time: Date.now(),
      pid: process.pid,
      name: 'app',
      instance: d.instance,
      ...extra,
      msg,
    }) + '\n';
  try {
    writeSync(2, line);
  } catch {
    /* stderr closed */
  }
  if (d.logFile) {
    try {
      mkdirSync(path.dirname(d.logFile), { recursive: true });
      appendFileSync(d.logFile, line);
    } catch {
      /* log dir not writable */
    }
  }
}

setInterval(() => {
  const beat = Atomics.load(d.shared, 0);
  const now = Date.now();
  if (beat !== lastBeat) {
    if (reported) write(30, 'event loop recovered', { blockedMs: now - lastChange });
    lastBeat = beat;
    lastChange = now;
    reported = false;
    return;
  }
  if (!reported && now - lastChange > d.thresholdMs) {
    reported = true;
    const i = Atomics.load(d.shared, 1);
    const slot = i > 0 ? d.slotNames[i - 1] : undefined;
    write(
      50,
      'event loop blocked: learner code is stuck in a synchronous loop and this app instance is frozen. Fix the file, then restart the app container.',
      {
        blockedMs: now - lastChange,
        suspectSlot: slot ?? null,
      },
    );
  }
}, 250);
