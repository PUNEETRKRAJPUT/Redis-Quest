// One snapshot of the running Redis's own command names and documentation (`COMMAND LIST`, `COMMAND DOCS`),
// served from memory to the terminal's completion and syntax hints (E-06).
//
// Why a snapshot and not a proxy: anything sent through POST /api/cli is counted by `INFO commandstats`, which
// lessons read, and can raise level events (`redis_busy`). Serving help must therefore send zero commands to Redis.
// The snapshot is taken on the engine's own main link, never inside a request, and never writes a key.
import type { Logger } from 'pino';
import type { RedisManager } from './redis.js';
import { normalizeReply, type Reply } from './verify/reply.js';

/** The engine asks for at most this many names per request (the UI batches 20). */
export const MAX_NAMES = 20;
const NAME_RE = /^[A-Za-z0-9_.|-]{1,64}$/;
/** A script that blocks Redis answers BUSY at once; this only covers a connection that goes quiet. */
const SNAPSHOT_TIMEOUT_MS = 8000;

export class CommandDocsInputError extends Error {}

export interface Snapshot {
  /** The server's COMMAND LIST, verbatim and in the server's order. */
  names: string[];
  /** Lowercase top-level command name to its `[name, doc]` pair, as `COMMAND DOCS` returned it. */
  docs: Map<string, [Reply, Reply]>;
}

/**
 * Builds a snapshot from the two raw replies. `COMMAND DOCS` with no arguments returns a map of every command
 * (measured on this stack: a flat `[name, doc, name, doc, ...]` array holding top-level commands only, with each
 * command's subcommands nested inside its own doc).
 */
export function buildSnapshot(rawList: unknown, rawDocs: unknown): Snapshot {
  const list = normalizeReply(rawList);
  const flat = normalizeReply(rawDocs);
  if (!Array.isArray(list) || !list.every((n) => typeof n === 'string'))
    throw new Error('COMMAND LIST did not return a list of names');
  if (!Array.isArray(flat) || flat.length % 2 !== 0)
    throw new Error('COMMAND DOCS did not return a map');
  const docs = new Map<string, [Reply, Reply]>();
  for (let i = 0; i < flat.length; i += 2) {
    const name = flat[i] as Reply;
    if (typeof name === 'string') docs.set(name.toLowerCase(), [name, flat[i + 1] as Reply]);
  }
  return { names: list as string[], docs };
}

/** The `names` query parameter: comma separated, 1 to MAX_NAMES plain command names. */
export function parseNames(raw: unknown): string[] {
  if (typeof raw !== 'string' || raw === '')
    throw new CommandDocsInputError('names is required: a comma-separated list of command names');
  const names = raw.split(',');
  if (names.length > MAX_NAMES)
    throw new CommandDocsInputError(`at most ${MAX_NAMES} names per request`);
  if (!names.every((n) => NAME_RE.test(n)))
    throw new CommandDocsInputError('names must be plain command names like get or client|list');
  return names;
}

/** What `COMMAND DOCS a b` would answer: a flat map, in the order asked, unknown names absent. */
export function pickDocs(snap: Snapshot, names: string[]): Reply[] {
  const out: Reply[] = [];
  const seen = new Set<string>();
  for (const n of names) {
    const key = n.toLowerCase();
    const entry = snap.docs.get(key);
    if (!entry || seen.has(key)) continue;
    seen.add(key);
    out.push(entry[0], entry[1]);
  }
  return out;
}

type Source = Pick<RedisManager, 'send' | 'isUp' | 'url'>;

export class CommandDocs {
  private snap: { url: string; value: Snapshot } | null = null;
  private inFlight = false;

  constructor(
    private readonly redis: Source,
    private readonly log: Logger,
  ) {}

  /** The snapshot for the server the engine is connected to right now, or null (never from a stale target). */
  snapshot(): Snapshot | null {
    return this.snap && this.snap.url === this.redis.url ? this.snap.value : null;
  }

  /**
   * Called each time the main connection becomes ready. Takes a snapshot if there is none for this target; a
   * reconnect to the same server keeps what it has, and a failure waits for the next "up". Never throws.
   */
  async ensure(): Promise<void> {
    const url = this.redis.url;
    if (this.inFlight || this.snapshot() || !this.redis.isUp) return;
    this.inFlight = true;
    try {
      let timer: NodeJS.Timeout | undefined;
      const timeout = new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error('no answer')), SNAPSHOT_TIMEOUT_MS);
      });
      const value = await Promise.race([
        (async () => {
          const rawList = await this.redis.send(['COMMAND', 'LIST']);
          return buildSnapshot(rawList, await this.redis.send(['COMMAND', 'DOCS']));
        })(),
        timeout,
      ]).finally(() => clearTimeout(timer));
      // The target may have changed while the commands ran: that snapshot belongs to the old server.
      if (url === this.redis.url) this.snap = { url, value };
      this.log.info(
        {
          names: value.names.length,
          documented: value.docs.size,
          bytes: JSON.stringify([...value.docs.values()]).length,
        },
        'command docs snapshot taken',
      );
    } catch (err) {
      this.log.warn(
        { err: (err as Error).message },
        'command docs snapshot not taken; will retry when redis comes up again',
      );
    } finally {
      this.inFlight = false;
    }
    // The target changed during the attempt and its own "up" arrived while this one was busy: do it now.
    if (url !== this.redis.url) await this.ensure();
  }
}
