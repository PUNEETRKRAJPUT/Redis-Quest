import path from 'node:path';
import { watch, type FSWatcher } from 'chokidar';
import type { Logger } from 'pino';
import {
  callLearner,
  createLearnerDeps,
  loadLearnerModule,
  toLearnerError,
  type LearnerContext,
  type LearnerError,
  type LearnerFn,
  type LearnerRedis,
} from '@quest/shared';
import type pg from 'pg';
import { SlotError } from '../errors.js';
import type { SlotDef } from './types.js';

/** How a slot call was served, reported in `x-quest-slots` and `/app/slots`. */
export type SlotPath = 'baseline' | 'learner' | 'baseline-load-error';

type LoadResult = { ok: true; fn: LearnerFn; at: string } | { ok: false; error: LearnerError; at: string };

export interface SlotState {
  name: string;
  file: string;
  exportName: string;
  signature: string;
  returns: string;
  active: boolean;
  /** inactive: baseline; loaded: learner code runs; load_error: active but serving baseline; pending: loading. */
  state: 'inactive' | 'pending' | 'loaded' | 'load_error';
  error?: { name: string; message: string };
  loadedAt?: string;
}

/** Marks the learner function that started last, for the event-loop watchdog. */
export interface LoopMarker {
  enter(slotIndex: number): void;
}

/**
 * Per-request state: one counted deps context for every slot and query in the request (so the route's
 * dbQueries/redisCommands are the request's totals), and the list of how each slot was served.
 */
export class RequestScope {
  readonly served: string[] = [];
  private constructor(private readonly ctx: LearnerContext) {}

  static async create(opts: { redis: LearnerRedis; pool: pg.Pool; log: (line: string) => void }): Promise<RequestScope> {
    const ctx = await createLearnerDeps({ redisClient: opts.redis, dbPool: opts.pool, log: opts.log });
    return new RequestScope(ctx);
  }

  get deps() {
    return this.ctx.deps;
  }

  get counters() {
    return this.ctx.counters;
  }

  /** Closes duplicates the learner opened; never the shared client or pool. */
  close(): Promise<void> {
    return this.ctx.close();
  }
}

export interface SlotRuntimeOptions {
  registry: readonly SlotDef[];
  workspaceDir: string;
  timeoutMs: number;
  filePollMs: number;
  log: Logger;
  marker?: LoopMarker;
}

export class SlotRuntime {
  private readonly defs = new Map<string, SlotDef>();
  private readonly index = new Map<string, number>();
  private activeSet = new Set<string>();
  private readonly cache = new Map<string, Promise<LoadResult>>();
  private readonly last = new Map<string, LoadResult>();
  private watcher?: FSWatcher;
  private readonly unknownWarned = new Set<string>();

  constructor(private readonly opts: SlotRuntimeOptions) {
    opts.registry.forEach((d, i) => {
      this.defs.set(d.name, d);
      this.index.set(d.name, i);
    });
  }

  /** Poll every slot file (bind mounts on macOS do not deliver fs events), active or not. */
  async startWatching(): Promise<void> {
    const byFile = new Map<string, string[]>();
    for (const d of this.defs.values()) {
      const abs = path.resolve(this.opts.workspaceDir, d.file);
      byFile.set(abs, [...(byFile.get(abs) ?? []), d.name]);
    }
    this.watcher = watch([...byFile.keys()], {
      usePolling: true,
      interval: this.opts.filePollMs,
      ignoreInitial: true,
      persistent: false,
    });
    const onFile = (event: string) => (file: string) => {
      const names = byFile.get(path.resolve(file)) ?? [];
      for (const name of names) {
        this.cache.delete(name);
        this.last.delete(name);
        this.opts.log.info({ slot: name, file: this.defs.get(name)?.file, event }, 'learner file changed');
        if (this.activeSet.has(name)) void this.load(this.defs.get(name)!);
      }
    };
    this.watcher.on('add', onFile('add')).on('change', onFile('change')).on('unlink', onFile('unlink'));
    this.watcher.on('error', (err) => this.opts.log.warn({ err: (err as Error).message }, 'file watcher error'));
    await new Promise<void>((resolve) => this.watcher!.once('ready', () => resolve()));
  }

  get active(): string[] {
    return [...this.activeSet].sort();
  }

  /** Apply the engine's list. Unknown names are ignored with one warning (usually a typo in a level). */
  setActive(names: readonly string[]): void {
    const next = new Set<string>();
    for (const n of names) {
      if (this.defs.has(n)) next.add(n);
      else if (!this.unknownWarned.has(n)) {
        this.unknownWarned.add(n);
        this.opts.log.warn({ slot: n }, 'engine activated a slot this app does not declare; ignored');
      }
    }
    const added = [...next].filter((n) => !this.activeSet.has(n));
    const removed = [...this.activeSet].filter((n) => !next.has(n));
    this.activeSet = next;
    if (added.length || removed.length) this.opts.log.info({ added, removed, active: this.active }, 'active slots changed');
    // Load eagerly so a broken file shows up in the log at activation, not on the first request.
    for (const n of added) void this.load(this.defs.get(n)!);
  }

  private load(def: SlotDef): Promise<LoadResult> {
    const cached = this.cache.get(def.name);
    if (cached) return cached;
    const p: Promise<LoadResult> = loadLearnerModule(this.opts.workspaceDir, def.file, def.exportName ?? 'default').then(
      (m) => ({ ok: true as const, fn: m.fn, at: new Date().toISOString() }),
      (err: unknown) => ({ ok: false as const, error: toLearnerError(err), at: new Date().toISOString() }),
    );
    this.cache.set(def.name, p);
    void p.then((r) => {
      if (this.cache.get(def.name) !== p) return; // superseded by a newer file version
      this.last.set(def.name, r);
      if (r.ok) this.opts.log.info({ slot: def.name, file: def.file }, 'learner module loaded');
      else
        this.opts.log.error(
          { slot: def.name, file: def.file, err: { name: r.error.name, message: r.error.message } },
          'learner module failed to load; serving the baseline',
        );
    });
    return p;
  }

  /**
   * Run a slot for one request. Inactive or unloadable: the baseline, whose errors propagate as app errors.
   * Active and loaded: the learner function with the request's deps and SLOT_TIMEOUT_MS; a throw, a
   * timeout or a non-JSON-safe failure becomes a SlotError (500 + x-quest-slot-error).
   */
  async call(scope: RequestScope, name: string, ...args: unknown[]): Promise<unknown> {
    const def = this.defs.get(name);
    if (!def) throw new Error(`no slot named ${name} in app/src/slots/registry.ts`);
    if (!this.activeSet.has(name)) {
      scope.served.push(`${name}=baseline`);
      return def.baseline(scope.deps, ...args);
    }
    const loaded = await this.load(def);
    if (!loaded.ok) {
      scope.served.push(`${name}=baseline-load-error`);
      return def.baseline(scope.deps, ...args);
    }
    scope.served.push(`${name}=learner`);
    const i = this.index.get(name)!;
    const marker = this.opts.marker;
    const fn: LearnerFn = marker
      ? (deps, ...a) => {
          marker.enter(i);
          return loaded.fn(deps, ...a);
        }
      : loaded.fn;
    const r = await callLearner(fn, scope.deps, args, { timeoutMs: this.opts.timeoutMs });
    if (!r.ok) throw new SlotError(name, r.error ?? { name: 'Error', message: 'unknown learner error' });
    return r.value;
  }

  /** Contract violations in what learner code returned are reported exactly like a throw. */
  contractError(name: string, message: string): SlotError {
    return new SlotError(name, { name: 'SlotContractError', message: `${name}: ${message}` });
  }

  isLearner(scope: RequestScope, name: string): boolean {
    return scope.served.includes(`${name}=learner`);
  }

  status(): SlotState[] {
    return [...this.defs.values()].map((d) => {
      const active = this.activeSet.has(d.name);
      const r = this.last.get(d.name);
      const base = {
        name: d.name,
        file: d.file,
        exportName: d.exportName ?? 'default',
        signature: d.signature,
        returns: d.returns,
        active,
      };
      if (!active) return { ...base, state: 'inactive' as const };
      if (!r) return { ...base, state: 'pending' as const };
      if (r.ok) return { ...base, state: 'loaded' as const, loadedAt: r.at };
      return { ...base, state: 'load_error' as const, error: { name: r.error.name, message: r.error.message }, loadedAt: r.at };
    });
  }

  slotNames(): string[] {
    return [...this.defs.keys()];
  }

  async close(): Promise<void> {
    await this.watcher?.close();
  }
}
