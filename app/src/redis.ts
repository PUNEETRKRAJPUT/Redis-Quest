import { createClient } from 'redis';
import type { Logger } from 'pino';
import type { LearnerRedis } from '@quest/shared';

type Client = ReturnType<typeof createClient>;

function makeClient(url: string, log: Logger, role: string): Client {
  const client = createClient({
    url,
    // Fail fast while Redis is unreachable instead of queueing: a learner slot then sees an error it can
    // handle (the "Redis is down, keep serving" lessons), and nothing replays after a reconnect.
    disableOfflineQueue: true,
    socket: {
      connectTimeout: 3000,
      // Never give up: Redis may be down for minutes in Chapter 5 and the app must come back by itself.
      reconnectStrategy: (retries: number) => Math.min(100 * 2 ** retries, 2000),
    },
  });
  let lastMsg = '';
  let lastAt = 0;
  client.on('error', (err: Error) => {
    // One line per distinct message per 10 s: a down Redis would otherwise flood app.log.
    const now = Date.now();
    if (err.message !== lastMsg || now - lastAt > 10_000) {
      log.warn({ redis: url, role, err: err.message }, 'redis client error');
      lastMsg = err.message;
      lastAt = now;
    }
  });
  client.on('ready', () => log.info({ redis: url, role }, 'redis ready'));
  return client;
}

async function closeQuietly(client: Client): Promise<void> {
  try {
    if (!client.isOpen) return;
    await Promise.race([
      client.close(),
      new Promise<void>((resolve) => setTimeout(resolve, 2000).unref()),
    ]);
  } catch {
    /* already closed */
  }
  try {
    if (client.isOpen) client.destroy();
  } catch {
    /* ignore */
  }
}

/**
 * The instance's current Redis target: one shared client for every slot call, plus one duplicate kept
 * for later subscribe/blocking needs. `switchTo` replaces both; the engine decides the URL.
 */
export class RedisTarget {
  private client: Client;
  private reserved: Client;
  private currentUrl: string;

  constructor(
    url: string,
    private readonly log: Logger,
  ) {
    this.currentUrl = url;
    this.client = makeClient(url, log, 'shared');
    this.reserved = makeClient(url, log, 'reserved');
    this.connect(this.client);
    this.connect(this.reserved);
  }

  private connect(c: Client): void {
    // Not awaited: the app must serve baselines even when Redis is down at boot.
    c.connect().catch((err: Error) => this.log.warn({ err: err.message }, 'redis connect failed'));
  }

  get url(): string {
    return this.currentUrl;
  }

  get ready(): boolean {
    return this.client.isReady;
  }

  /** The shared client handed to learner code (wrapped by the counting proxy per request). */
  get shared(): LearnerRedis {
    return this.client as unknown as LearnerRedis;
  }

  /** Reserved for subscribe/blocking slots (not exposed to learner code yet). */
  get reservedClient(): LearnerRedis {
    return this.reserved as unknown as LearnerRedis;
  }

  async switchTo(url: string): Promise<void> {
    if (url === this.currentUrl) return;
    const oldClient = this.client;
    const oldReserved = this.reserved;
    this.log.info({ from: this.currentUrl, to: url }, 'redis target switched');
    this.currentUrl = url;
    this.client = makeClient(url, this.log, 'shared');
    this.reserved = makeClient(url, this.log, 'reserved');
    this.connect(this.client);
    this.connect(this.reserved);
    // In-flight commands on the old client finish (close() drains); new requests already use the new one.
    await Promise.all([closeQuietly(oldClient), closeQuietly(oldReserved)]);
  }

  async close(): Promise<void> {
    await Promise.all([closeQuietly(this.client), closeQuietly(this.reserved)]);
  }
}
