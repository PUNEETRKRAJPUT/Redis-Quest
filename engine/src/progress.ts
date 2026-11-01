import { randomBytes } from 'node:crypto';
import { mkdir, open, readdir, readFile, rename, rm } from 'node:fs/promises';
import { join } from 'node:path';

export type LevelStatus = 'locked' | 'available' | 'in_progress' | 'passed';

/**
 * E-04: what a traffic check measured, kept on the verdict record so the portfolio can quote it from the save
 * alone ("p99 4,100 ms to 11 ms"). Only the numbers the check produced are present.
 */
export interface VerdictMetrics {
  p99Ms?: number;
  baselineP99Ms?: number;
  dbPerRequest?: number;
  baselineDbPerRequest?: number;
  redisPerRequest?: number;
  hitRatio?: number;
  rps?: number;
}

export interface VerdictRecord {
  at: string;
  verdict: string;
  overtime?: true;
  /** E-04: from the traffic check, when the level has one and it ran. */
  metrics?: VerdictMetrics;
  /** E-04, interview levels: ms from the start of the interview clock to the verify request. */
  elapsedMs?: number;
}

export interface LevelProgress {
  status: LevelStatus;
  attempts: number;
  verdicts: VerdictRecord[];
  brainstorm?: { optionId: string; text: string; at: string };
  completedAt?: string;
  /** Additive to the P0-06 spec: set by POST /levels/:id/start (the event verifier looks back to this). */
  startedAt?: string;
  /** Additive: how many hints the learner has revealed. */
  hintsRevealed?: number;
  /** F-12, interview levels only. When the clock started; the first start wins. */
  interviewStartedAt?: string;
  /** F-12: hints bought on an interview level (each cost XP). */
  hintsBought?: number;
  /** F-12: set on the first pass: the time it took, and whether the deadline had passed by then. */
  interviewElapsedMs?: number;
  overtime?: boolean;
  /** E-04, pool levels: the `rebuild_of` the engine drew at the first start. The first start wins. */
  drawn?: string;
  /** E-04, blank-start levels: slot files moved aside at the first start (`[]` when nothing needed moving). */
  blanked?: { file: string; backup: string }[];
}

export interface ProgressFile {
  version: 1;
  player: { id: string; name: string; createdAt: string };
  target: { redisUrl: string };
  activeSlots: string[];
  levels: Record<string, LevelProgress>;
  xp: number;
  badges: string[];
}

export const PROGRESS_FILE_NAME = 'progress.json';

/** Writes `data` to `file` atomically: temp file in the same directory, fsync, rename. */
export async function writeFileAtomic(file: string, data: string): Promise<void> {
  const dir = join(file, '..');
  const tmp = `${file}.${process.pid}.${randomBytes(4).toString('hex')}.tmp`;
  await mkdir(dir, { recursive: true });
  const fh = await open(tmp, 'w');
  try {
    await fh.writeFile(data, 'utf8');
    await fh.sync();
  } finally {
    await fh.close();
  }
  try {
    await rename(tmp, file);
  } catch (err) {
    await rm(tmp, { force: true });
    throw err;
  }
}

export function isProgressFile(v: unknown): v is ProgressFile {
  if (!v || typeof v !== 'object') return false;
  const p = v as Record<string, unknown>;
  const player = p.player as Record<string, unknown> | undefined;
  const target = p.target as Record<string, unknown> | undefined;
  return (
    p.version === 1 &&
    !!player &&
    typeof player.id === 'string' &&
    typeof player.name === 'string' &&
    typeof player.createdAt === 'string' &&
    !!target &&
    typeof target.redisUrl === 'string' &&
    Array.isArray(p.activeSlots) &&
    !!p.levels &&
    typeof p.levels === 'object' &&
    !Array.isArray(p.levels) &&
    typeof p.xp === 'number' &&
    Array.isArray(p.badges)
  );
}

export type ReadResult =
  | { kind: 'missing' }
  | { kind: 'ok'; progress: ProgressFile }
  | { kind: 'invalid'; reason: string };

export async function readProgressFile(dir: string): Promise<ReadResult> {
  let text: string;
  try {
    text = await readFile(join(dir, PROGRESS_FILE_NAME), 'utf8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return { kind: 'missing' };
    throw err;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (err) {
    return { kind: 'invalid', reason: `not valid JSON: ${(err as Error).message}` };
  }
  if (!isProgressFile(parsed))
    return { kind: 'invalid', reason: 'does not match schema version 1' };
  return { kind: 'ok', progress: parsed };
}

/** Removes leftover temp files from a crash between write and rename. */
export async function cleanTempFiles(dir: string): Promise<void> {
  try {
    for (const name of await readdir(dir)) {
      if (name.startsWith(`${PROGRESS_FILE_NAME}.`) && name.endsWith('.tmp'))
        await rm(join(dir, name), { force: true });
    }
  } catch {
    // directory may not exist yet
  }
}

export function levelCounts(p: ProgressFile): Record<LevelStatus, number> {
  const c: Record<LevelStatus, number> = { locked: 0, available: 0, in_progress: 0, passed: 0 };
  for (const l of Object.values(p.levels)) c[l.status] += 1;
  return c;
}

/**
 * Makes `levels` cover exactly the known level ids (in play order) and applies the unlock rule:
 * the first level, and any level whose predecessor is passed, is at least `available`.
 * Returns true if anything changed. Entries for ids that no longer exist are kept (content may come back).
 */
export function reconcileLevels(p: ProgressFile, orderedIds: readonly string[]): boolean {
  let changed = false;
  orderedIds.forEach((id, i) => {
    let entry = p.levels[id];
    if (!entry) {
      entry = { status: 'locked', attempts: 0, verdicts: [] };
      p.levels[id] = entry;
      changed = true;
    }
    const prev = i === 0 ? undefined : p.levels[orderedIds[i - 1] as string];
    if (entry.status === 'locked' && (i === 0 || prev?.status === 'passed')) {
      entry.status = 'available';
      changed = true;
    }
  });
  return changed;
}

export function newProgress(args: {
  id: string;
  name: string;
  redisUrl: string;
  activeSlots: string[];
  now: Date;
}): ProgressFile {
  return {
    version: 1,
    player: { id: args.id, name: args.name, createdAt: args.now.toISOString() },
    target: { redisUrl: args.redisUrl },
    activeSlots: args.activeSlots,
    levels: {},
    xp: 0,
    badges: [],
  };
}

/**
 * Holds the in-memory copy of progress.json and writes every change to disk before anything else
 * learns of it. Changes are serialised so two requests never interleave a read-modify-write.
 */
export class ProgressStore {
  current: ProgressFile | null = null;
  private chain: Promise<unknown> = Promise.resolve();

  constructor(readonly dir: string) {}

  get file(): string {
    return join(this.dir, PROGRESS_FILE_NAME);
  }

  async load(): Promise<ReadResult> {
    await mkdir(this.dir, { recursive: true });
    await cleanTempFiles(this.dir);
    const r = await readProgressFile(this.dir);
    if (r.kind === 'ok') this.current = r.progress;
    return r;
  }

  /** Re-reads the file from disk and makes it the in-memory copy (restore). */
  async reloadFromDisk(): Promise<ReadResult> {
    const r = await readProgressFile(this.dir);
    if (r.kind === 'ok') this.current = r.progress;
    return r;
  }

  /** Runs `fn` on a copy, writes the result atomically, then swaps it in. `fn` may return a value for the caller. */
  update<T>(fn: (draft: ProgressFile) => T): Promise<T> {
    const run = async (): Promise<T> => {
      if (!this.current) throw new Error('no player');
      const draft = structuredClone(this.current);
      const out = fn(draft);
      await writeFileAtomic(this.file, `${JSON.stringify(draft, null, 2)}\n`);
      this.current = draft;
      return out;
    };
    const next = this.chain.then(run, run);
    this.chain = next.catch(() => undefined);
    return next;
  }

  /** Creates the file for a new player. */
  create(p: ProgressFile): Promise<void> {
    const run = async () => {
      await writeFileAtomic(this.file, `${JSON.stringify(p, null, 2)}\n`);
      this.current = p;
    };
    const next = this.chain.then(run, run);
    this.chain = next.catch(() => undefined);
    return next;
  }
}
