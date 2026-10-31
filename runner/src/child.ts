// Child-process entry: the only place learner code is ever imported. One job per process, then exit.
import {
  aggregateMetrics,
  createLearnerDeps,
  loadLearnerModule,
  runLearnerCalls,
  toLearnerError,
  type LearnerCallResult,
  type LearnerCounters,
} from '@quest/shared';
import type { ChildJob, ChildReply } from './protocol.js';

const MAX_LOG_LINES = 1000;
const MAX_LINE = 2000;
const logs: string[] = [];
const pushLog = (line: string): void => {
  if (logs.length < MAX_LOG_LINES) logs.push(line.length > MAX_LINE ? `${line.slice(0, MAX_LINE)}...` : line);
  else if (logs.length === MAX_LOG_LINES) logs.push('[log truncated]');
};

// Stray async failures in learner code must not kill the child before it reports.
process.on('unhandledRejection', (reason) => pushLog(`[unhandledRejection] ${toLearnerError(reason).message}`));
process.on('uncaughtException', (err) => pushLog(`[uncaughtException] ${err.message}`));

function send(reply: ChildReply): void {
  process.send?.(reply, () => process.exit(0));
}

async function runJob(job: ChildJob): Promise<ChildReply> {
  if (job.mode === 'load') {
    try {
      const { exports } = await loadLearnerModule(job.workspaceDir, job.module, job.exportName);
      return { mode: 'load', ok: true, exports: Object.keys(exports), logs };
    } catch (err) {
      return { mode: 'load', ok: false, exports: [], error: toLearnerError(err), logs };
    }
  }

  const started = performance.now();
  const failAll = (err: unknown, counters?: LearnerCounters): ChildReply => {
    const error = toLearnerError(err);
    const results: LearnerCallResult[] = job.calls.map(() => ({ ok: false, error, ms: 0 }));
    return {
      mode: 'run',
      results,
      metrics: aggregateMetrics(results, counters ?? { redisCommands: 0, dbQueries: 0 }, performance.now() - started),
      logs,
    };
  };

  let ctx;
  try {
    ctx = await createLearnerDeps({ redisUrl: job.redisUrl, databaseUrl: job.databaseUrl, log: pushLog });
  } catch (err) {
    return failAll(err);
  }
  try {
    const { fn } = await loadLearnerModule(job.workspaceDir, job.module, job.exportName);
    const results = await runLearnerCalls(fn, ctx.deps, job.calls, {
      concurrency: job.concurrency,
      timeoutMs: job.timeoutMs,
    });
    // Let rejections the learner left unhandled surface into the logs before we reply.
    await new Promise((r) => setTimeout(r, 10));
    return {
      mode: 'run',
      results,
      metrics: aggregateMetrics(results, ctx.counters, performance.now() - started),
      logs,
    };
  } catch (err) {
    return failAll(err, ctx.counters);
  } finally {
    // Never wait on a hung connection for long; the process exits right after the reply.
    await Promise.race([ctx.close(), new Promise((r) => setTimeout(r, 1500).unref())]);
  }
}

process.once('message', (job: ChildJob) => {
  runJob(job).then(send, (err) => {
    console.error(err);
    process.exit(2);
  });
});
