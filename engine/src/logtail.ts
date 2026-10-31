import { open, readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import type { EventBus } from './events.js';

export const LOG_SERVICES = ['app', 'runner', 'proxy', 'postgres'] as const;
export type LogService = (typeof LOG_SERVICES)[number];
const RING = 500;
const INITIAL_TAIL_BYTES = 64 * 1024;
const MAX_READ = 256 * 1024;
const MAX_DEPTH = 4;

interface FileState {
  offset: number;
  partial: string;
  /** The tail read began mid-line; drop the first fragment. */
  skipFirst: boolean;
}

/** Polls `${logDir}/<service>/**` (bind mounts deliver no reliable change events) and streams new lines. */
export class LogTail {
  private rings = new Map<LogService, string[]>();
  private files = new Map<string, FileState>();
  private timer: NodeJS.Timeout | null = null;
  private running = false;
  private started = false;

  constructor(
    private readonly logDir: string,
    private readonly bus: EventBus,
    private readonly intervalMs = 1000,
  ) {
    for (const s of LOG_SERVICES) this.rings.set(s, []);
  }

  lines(service: LogService, n = RING): string[] {
    const ring = this.rings.get(service) ?? [];
    return ring.slice(-Math.min(Math.max(n, 1), RING));
  }

  async start(): Promise<void> {
    await this.poll(true); // existing content seeds the rings without being streamed
    this.started = true;
    this.timer = setInterval(() => void this.poll(false), this.intervalMs);
    this.timer.unref();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  /** One scan of all services. Exposed for tests. */
  async poll(seed = false): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      for (const service of LOG_SERVICES) {
        for (const file of await listFiles(join(this.logDir, service), 0)) {
          await this.readNew(service, file, seed);
        }
      }
    } finally {
      this.running = false;
    }
  }

  private push(service: LogService, line: string, stream: boolean): void {
    const ring = this.rings.get(service) as string[];
    ring.push(line);
    if (ring.length > RING) ring.shift();
    if (stream) this.bus.emit('log.line', { service, line });
  }

  private async readNew(service: LogService, file: string, seed: boolean): Promise<void> {
    let size: number;
    try {
      size = (await stat(file)).size;
    } catch {
      return;
    }
    let st = this.files.get(file);
    if (!st) {
      // First sight of a file: at startup keep only the tail; a file created later is read from the start.
      const offset = seed || !this.started ? Math.max(0, size - INITIAL_TAIL_BYTES) : 0;
      st = { offset, partial: '', skipFirst: offset > 0 };
      this.files.set(file, st);
    }
    if (size < st.offset) {
      st.offset = 0; // truncated or rotated in place
      st.partial = '';
      st.skipFirst = false;
    }
    if (size === st.offset) return;
    const len = Math.min(size - st.offset, MAX_READ);
    const fh = await open(file, 'r');
    try {
      const buf = Buffer.alloc(len);
      const { bytesRead } = await fh.read(buf, 0, len, st.offset);
      st.offset += bytesRead;
      const parts = (st.partial + buf.toString('utf8', 0, bytesRead)).split('\n');
      st.partial = parts.pop() ?? '';
      let lines = parts.map((l) => l.replace(/\r$/, ''));
      if (st.skipFirst && parts.length > 0) {
        lines = lines.slice(1);
        st.skipFirst = false;
      }
      for (const line of lines) if (line.length > 0) this.push(service, line, !seed);
    } finally {
      await fh.close();
    }
  }
}

async function listFiles(dir: string, depth: number): Promise<string[]> {
  if (depth > MAX_DEPTH) return [];
  let names: string[];
  try {
    names = await readdir(dir);
  } catch {
    return [];
  }
  const out: string[] = [];
  for (const name of names.sort()) {
    const p = join(dir, name);
    try {
      const st = await stat(p);
      if (st.isDirectory()) out.push(...(await listFiles(p, depth + 1)));
      else if (st.isFile()) out.push(p);
    } catch {
      // vanished between readdir and stat
    }
  }
  return out;
}
