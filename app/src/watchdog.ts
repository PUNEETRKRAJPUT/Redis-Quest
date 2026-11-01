import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { Worker } from 'node:worker_threads';
import type { Logger } from 'pino';
import type { LoopMarker } from './slots/runtime.js';

/**
 * A synchronous infinite loop in learner code blocks this instance's event loop, and nothing in-process
 * can interrupt it (callLearner's timeout only abandons async work). This watchdog cannot fix that
 * either; it makes it visible: a worker thread notices the heartbeat stop and writes to app.log (which
 * the engine tails) naming the slot whose function started last, so the learner learns why the app froze.
 *
 * Shared memory layout (Int32Array): [0] heartbeat counter, [1] index+1 of the last learner slot entered.
 */
export class LoopWatchdog implements LoopMarker {
  private readonly shared = new Int32Array(new SharedArrayBuffer(8));
  private beat?: NodeJS.Timeout;
  private worker?: Worker;

  constructor(opts: { slotNames: string[]; thresholdMs: number; logFile?: string; instance: string; log: Logger }) {
    const workerFile = fileURLToPath(new URL('./watchdog-worker.js', import.meta.url));
    if (!existsSync(workerFile)) {
      // Running from TypeScript sources (vitest): no compiled worker, no watchdog.
      opts.log.debug('watchdog worker not built; event-loop watchdog disabled');
      return;
    }
    this.beat = setInterval(() => Atomics.add(this.shared, 0, 1), 100);
    this.beat.unref();
    this.worker = new Worker(workerFile, {
      workerData: {
        shared: this.shared,
        slotNames: opts.slotNames,
        thresholdMs: opts.thresholdMs,
        logFile: opts.logFile,
        instance: opts.instance,
      },
    });
    this.worker.unref();
    this.worker.on('error', (err) => opts.log.warn({ err: err.message }, 'watchdog worker failed'));
  }

  enter(slotIndex: number): void {
    Atomics.store(this.shared, 1, slotIndex + 1);
  }

  async close(): Promise<void> {
    if (this.beat) clearInterval(this.beat);
    await this.worker?.terminate();
  }
}
