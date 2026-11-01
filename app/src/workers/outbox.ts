import type { Logger } from 'pino';
import type pg from 'pg';
import type { LearnerRedis } from '@quest/shared';

export const CHANGES_STREAM = 'legacydb:changes';
const BATCH = 100;
const MAXLEN = 10_000;

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
      this.o.log.warn({ err: (err as Error).message }, 'outbox drain failed; will retry');
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
      for (const r of rows) {
        await redis.withAbortSignal(signal).xAdd(
          CHANGES_STREAM,
          '*',
          {
            aggregate: r.aggregate,
            aggregate_id: r.aggregate_id,
            op: r.op,
            payload: JSON.stringify(r.payload),
          },
          { TRIM: { strategy: 'MAXLEN', strategyModifier: '~', threshold: MAXLEN } },
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
