import type { Logger } from 'pino';
import type pg from 'pg';
import type { LearnerRedis } from '@quest/shared';

export const CHANGES_STREAM = 'legacydb:changes';
const BATCH = 100;
const MAXLEN = 10_000;

/** Rejects after 3 s unless the command was already given an AbortSignal that does the same. */
function withDeadline<T>(alreadyAborts: boolean, p: Promise<T>): Promise<T> {
  if (alreadyAborts) return p;
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('XADD got no reply within 3000 ms')), 3000);
    p.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (e: unknown) => {
        clearTimeout(timer);
        reject(e);
      },
    );
  });
}

interface OutboxRow {
  id: string;
  aggregate: string;
  aggregate_id: string;
  op: string;
  payload: unknown;
}

export interface OutboxOptions {
  /** The app's raw pool (no injected latency: this is the app's own plumbing, not the learner's code). */
  pool: pg.Pool;
  /** The current shared Redis client; read per tick because the engine can switch targets. */
  redis: () => LearnerRedis;
  log: Logger;
  /** Runs while true: the prefetch.applyChange slot is active, or APP_OUTBOX_ALWAYS=1. */
  enabled: () => boolean;
  intervalMs?: number;
}

/**
 * Change data capture, second half (the triggers of P0-04 are the first): every instance polls the unpublished
 * outbox rows once a second and publishes them to the `legacydb:changes` stream. `FOR UPDATE SKIP LOCKED`
 * means two instances never take the same row; the row is marked published in the same transaction as the
 * XADDs, so a crash between them re-publishes (at-least-once) and never loses a change.
 */
export class OutboxDrainer {
  private timer?: NodeJS.Timeout;
  private busy = false;
  private stopped = false;
  private lastWarn = '';
  private lastWarnAt = 0;
  /** Rows published since boot (for tests and /app/health-style debugging). */
  published = 0;

  constructor(private readonly o: OutboxOptions) {}

  start(): void {
    const tick = (): void => {
      if (this.stopped) return;
      void this.drain().finally(() => {
        if (!this.stopped) this.timer = setTimeout(tick, this.o.intervalMs ?? 1000);
      });
    };
    this.timer = setTimeout(tick, this.o.intervalMs ?? 1000);
  }

  stop(): void {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
  }

  /** One pass: drain batches until the outbox is empty. Returns the number of rows published. */
  async drain(): Promise<number> {
    if (this.busy || !this.o.enabled()) return 0;
    this.busy = true;
    let total = 0;
    try {
      for (;;) {
        const n = await this.batch();
        total += n;
        if (n < BATCH) break;
      }
    } catch (err) {
      // Once per distinct message per 10 s: a read-only replica target (READONLY on every XADD) or a Redis that
      // is down would otherwise write a line every second, for as long as there are unpublished rows.
      const msg = (err as Error).message;
      const now = Date.now();
      if (msg !== this.lastWarn || now - this.lastWarnAt > 10_000) {
        this.o.log.warn({ err: msg }, 'outbox drain failed; will retry');
        this.lastWarn = msg;
        this.lastWarnAt = now;
      }
    } finally {
      this.busy = false;
    }
    return total;
  }

  private async batch(): Promise<number> {
    const client = await this.o.pool.connect();
    try {
      await client.query('BEGIN');
      const { rows } = await client.query<OutboxRow>(
        `SELECT id, aggregate, aggregate_id, op, payload FROM outbox
          WHERE published_at IS NULL ORDER BY id LIMIT ${BATCH} FOR UPDATE SKIP LOCKED`,
      );
      if (rows.length === 0) {
        await client.query('COMMIT');
        return 0;
      }
      const redis = this.o.redis();
      const signal = AbortSignal.timeout(3000);
      // Only a single-node client has withAbortSignal; Sentinel and cluster clients do not, so there the XADD
      // races a timer instead (a command with no reply by then fails the batch, which rolls back and retries).
      const abortable = (redis as { withAbortSignal?: (s: AbortSignal) => LearnerRedis })
        .withAbortSignal;
      const target = typeof abortable === 'function' ? abortable.call(redis, signal) : redis;
      for (const r of rows) {
        await withDeadline(
          typeof abortable === 'function',
          target.xAdd(
            CHANGES_STREAM,
            '*',
            {
              aggregate: r.aggregate,
              aggregate_id: r.aggregate_id,
              op: r.op,
              payload: JSON.stringify(r.payload),
            },
            { TRIM: { strategy: 'MAXLEN', strategyModifier: '~', threshold: MAXLEN } },
          ),
        );
      }
      await client.query('UPDATE outbox SET published_at = now() WHERE id = ANY($1::bigint[])', [
        rows.map((r) => r.id),
      ]);
      await client.query('COMMIT');
      this.published += rows.length;
      this.o.log.info(
        { rows: rows.length, firstId: rows[0]!.id, lastId: rows[rows.length - 1]!.id },
        `outbox: published ${rows.length} change(s) to ${CHANGES_STREAM}`,
      );
      return rows.length;
    } catch (err) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw err;
    } finally {
      client.release();
    }
  }
}
