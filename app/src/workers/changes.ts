import {
  clientIsReady,
  createTargetClient,
  parseTarget,
  reconnectStrategyFor,
  type LearnerRedis,
} from '@quest/shared';
import type { Logger } from 'pino';
import type { ChangeEvent } from '../slots/baselines.js';
import { CHANGES_STREAM } from './outbox.js';
import { callSlotInBackground, sleep, type BackgroundDeps } from './common.js';

const SLOT = 'prefetch.applyChange';
const BLOCK_MS = 1000;

type Client = LearnerRedis;

/** Decode one stream entry; null when it is not one this app understands. */
export function decodeChange(message: Record<string, string>): ChangeEvent | null {
  const { aggregate, aggregate_id: aggregateId, op, payload } = message;
  if (!aggregate || !aggregateId || (op !== 'insert' && op !== 'update' && op !== 'delete'))
    return null;
  try {
    const parsed = JSON.parse(payload ?? 'null') as unknown;
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return null;
    return { aggregate, aggregateId, op, payload: parsed as Record<string, unknown> };
  } catch {
    return null;
  }
}

/**
 * The provided consumer loop for level 2.7. Every instance tails `legacydb:changes` with `XREAD BLOCK`
 * from `$` (fan-out: each instance sees every entry) on its own connection, because a blocking read ties
 * the connection up, and calls the `prefetch.applyChange` slot per entry while the slot is active. Entries
 * that arrive while the slot is inactive are skipped on purpose: the activation itself starts at `$`.
 */
export class ChangeConsumer {
  private stopped = false;
  private client?: Client;
  private clientUrl = '';
  private lastId = '$';
  private wasActive = false;
  /** Entries handed to the slot since boot. */
  applied = 0;

  constructor(
    private readonly d: BackgroundDeps,
    private readonly active: () => boolean,
  ) {}

  start(): void {
    void this.loop();
  }

  async stop(): Promise<void> {
    this.stopped = true;
    await this.dropClient();
  }

  private makeClient(url: string, log: Logger): Client {
    // Its own connection of whatever kind the target is: a blocking XREAD ties the connection up.
    const target = parseTarget(url);
    const c = createTargetClient(target, {
      disableOfflineQueue: true,
      connectTimeoutMs: 3000,
      reconnectStrategy: reconnectStrategyFor(target.kind),
    }) as unknown as Client;
    let lastMsg = '';
    c.on('error', (err: Error) => {
      if (err.message !== lastMsg) log.warn({ err: err.message }, 'change consumer redis error');
      lastMsg = err.message;
    });
    c.on('ready', () => {
      lastMsg = '';
    });
    (c as unknown as { connect(): Promise<unknown> }).connect().catch(() => undefined);
    return c;
  }

  private async dropClient(): Promise<void> {
    const c = this.client;
    this.client = undefined;
    if (!c) return;
    try {
      void Promise.resolve(c.destroy()).catch(() => undefined);
    } catch {
      /* already closed */
    }
  }

  private async loop(): Promise<void> {
    while (!this.stopped) {
      try {
        if (!this.active()) {
          this.wasActive = false;
          await this.dropClient();
          await sleep(300);
          continue;
        }
        if (!this.wasActive) {
          this.wasActive = true;
          this.lastId = '$'; // start at "now" on every activation
          this.d.log.info({ stream: CHANGES_STREAM }, 'change consumer started (XREAD from $)');
        }
        const url = this.d.redis.url;
        if (!this.client || this.clientUrl !== url) {
          await this.dropClient();
          this.client = this.makeClient(url, this.d.log);
          this.clientUrl = url;
          this.lastId = '$';
        }
        if (!clientIsReady(this.client)) {
          await sleep(200);
          continue;
        }
        if (this.lastId === '$') {
          // `$` only means "new" for one call; pin it to the newest id so entries added between two
          // reads are not skipped ('0-0' for an empty or missing stream).
          const tail = await this.client.xRevRange(CHANGES_STREAM, '+', '-', { COUNT: 1 });
          this.lastId = String(tail[0]?.id ?? '0-0');
        }
        const res = await this.client.xRead(
          { key: CHANGES_STREAM, id: this.lastId },
          { BLOCK: BLOCK_MS, COUNT: 100 },
        );
        if (!res) continue;
        for (const stream of res as Array<{
          messages: Array<{ id: string; message: Record<string, string> }>;
        }>) {
          for (const m of stream.messages) {
            this.lastId = m.id;
            if (!this.active()) break;
            const event = decodeChange(m.message);
            if (!event) {
              this.d.log.warn({ id: m.id }, 'change consumer skipped an undecodable entry');
              continue;
            }
            await callSlotInBackground(this.d, SLOT, event);
            this.applied += 1;
          }
        }
      } catch (err) {
        // Redis down, client replaced, read cut off: back off briefly and read again from the last id.
        if (this.stopped) return;
        this.d.log.warn({ err: (err as Error).message }, 'change consumer read failed; retrying');
        await sleep(500);
      }
    }
  }
}
