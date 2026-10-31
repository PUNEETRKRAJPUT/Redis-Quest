import { fork } from 'node:child_process';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { aggregateMetrics, type LearnerCallResult, type LearnerMetrics } from '@quest/shared';
import type { ChildJob, ChildReply } from './protocol.js';

/** child.js sits next to this file when built; under vitest (TS sources) fall back to the built copy. */
export function childEntryPath(): string {
  const beside = fileURLToPath(new URL('./child.js', import.meta.url));
  return existsSync(beside) ? beside : fileURLToPath(new URL('../dist/child.js', import.meta.url));
}

export interface ExecOutcome {
  reply?: ChildReply;
  /** Set when the child died or was killed without replying. */
  crash?: { name: string; message: string };
  logs: string[];
}

const MAX_CAPTURE = 64 * 1024;

/**
 * Run one job in a fresh `node --max-old-space-size=256` child. The parent never imports learner code.
 * Hard kill at `killAfterMs` (spec: timeoutMs + 1000).
 */
export function runInChild(job: ChildJob, killAfterMs: number): Promise<ExecOutcome> {
  return new Promise((resolve) => {
    const child = fork(childEntryPath(), [], {
      execArgv: ['--max-old-space-size=256'],
      silent: true,
      env: { ...process.env, NODE_ENV: process.env.NODE_ENV ?? 'production' },
    });
    const captured: string[] = [];
    let size = 0;
    const capture = (tag: string) => (chunk: Buffer) => {
      if (size > MAX_CAPTURE) return;
      size += chunk.length;
      for (const line of chunk.toString('utf8').split('\n')) if (line.trim()) captured.push(`[${tag}] ${line}`);
    };
    child.stdout?.on('data', capture('stdout'));
    child.stderr?.on('data', capture('stderr'));

    let reply: ChildReply | undefined;
    let killed = false;
    let settled = false;
    const finish = (crash?: { name: string; message: string }): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      const logs = [...(reply?.logs ?? []), ...captured];
      resolve({ reply, crash: reply ? undefined : crash, logs });
    };

    const timer = setTimeout(() => {
      killed = true;
      child.kill('SIGKILL');
    }, killAfterMs);

    child.once('message', (m) => {
      reply = m as ChildReply;
    });
    child.once('error', (err) => finish({ name: 'ChildProcessError', message: err.message }));
    child.once('exit', (code, signal) => {
      // Wait a tick so a reply and buffered output that arrived just before exit are included.
      setImmediate(() => {
        if (reply) return finish();
        if (killed) {
          return finish({
            name: 'KilledError',
            message: `learner code did not finish in time and the process was killed after ${killAfterMs} ms (signal ${signal})`,
          });
        }
        finish({
          name: 'ChildExitError',
          message: `learner code ended the process before returning (exit code ${code ?? 'none'}, signal ${signal ?? 'none'})`,
        });
      });
    });
    child.send(job);
  });
}

/** Turn a crash into the same result shape a normal run returns. */
export function crashResults(
  job: ChildJob,
  crash: { name: string; message: string },
  totalMs: number,
): { results: LearnerCallResult[]; metrics: LearnerMetrics } {
  const results: LearnerCallResult[] = job.calls.map(() => ({ ok: false, error: crash, ms: 0 }));
  return { results, metrics: aggregateMetrics(results, { redisCommands: 0, dbQueries: 0 }, totalMs) };
}
