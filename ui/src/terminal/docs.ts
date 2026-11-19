// Command knowledge for the terminal: names and per-command documentation, read from the running Redis
// (`COMMAND LIST`, `COMMAND DOCS <name>`) and never written by hand. Everything here is plain functions plus one
// small store, so it runs under vitest without a DOM.
//
// WHERE THE DATA COMES FROM is a safety decision, see docs/handoffs/F-22.md ("Safety finding"): helper commands sent
// through POST /api/cli are counted by `INFO commandstats`, which the levels read and the learner reads, and a helper
// answered with BUSY raises the `redis_busy` level event. So the default source is a read-only engine endpoint that
// does not exist yet (`engineSource`); `cliSource` is the same thing over POST /api/cli, kept ready but not wired.
import { parseReply, type Reply } from '../redisReply';

// ---- the model ------------------------------------------------------------------------------------------------

export interface ArgDoc {
  /** The server's `name` field. */
  name: string;
  /** string, integer, double, key, pattern, unix-time, pure-token, oneof, block. */
  type: string;
  /** `display_text` when the server gives one, else `name`. */
  label: string;
  /** The literal word that introduces the argument (`EX`, `NX`, `LIMIT`). */
  token?: string;
  optional: boolean;
  multiple: boolean;
  multipleToken: boolean;
  since?: string;
  /** Alternatives of a oneof, or the sequence inside a block. */
  arguments: ArgDoc[];
}

export interface CommandDoc {
  /** `get`, or `client|list` for a subcommand. */
  name: string;
  summary: string;
  since?: string;
  group?: string;
  complexity?: string;
  deprecatedSince?: string;
  arguments: ArgDoc[];
  /** Keyed by the full name (`client|list`). */
  subcommands: Record<string, CommandDoc>;
}

// ---- reply to model --------------------------------------------------------------------------------------------

/** What both inputs (a parsed redis-cli reply, or JSON from the engine) are reduced to. */
export type Tree = string | number | null | Tree[] | { [k: string]: Tree };

export function treeFromReply(r: Reply): Tree {
  switch (r.kind) {
    case 'int':
      return r.v;
    case 'nil':
      return null;
    case 'array':
      return r.v.map(treeFromReply);
    case 'str':
    case 'status':
    case 'error':
      return r.v;
  }
}

/** A RESP2 map is a flat [key, value, key, value] array; JSON gives an object. Anything else is not a map. */
function mapOf(t: Tree | undefined): Map<string, Tree> | null {
  if (t === null || t === undefined) return null;
  if (Array.isArray(t)) {
    if (t.length % 2 !== 0) return null;
    const m = new Map<string, Tree>();
    for (let i = 0; i < t.length; i += 2) {
      const k = t[i];
      if (typeof k !== 'string') return null;
      m.set(k, t[i + 1] as Tree);
    }
    return m;
  }
  if (typeof t === 'object') return new Map(Object.entries(t));
  return null;
}

const str = (t: Tree | undefined): string | undefined =>
  typeof t === 'string' ? t : typeof t === 'number' ? String(t) : undefined;
const list = (t: Tree | undefined): Tree[] => (Array.isArray(t) ? t : []);

function argFromTree(t: Tree): ArgDoc | null {
  const m = mapOf(t);
  const name = str(m?.get('name'));
  if (!m || name === undefined) return null;
  const flags = list(m.get('flags')).map((f) => String(f));
  const sub = list(m.get('arguments'))
    .map(argFromTree)
    .filter((a): a is ArgDoc => a !== null);
  const token = str(m.get('token'));
  const since = str(m.get('since'));
  return {
    name,
    type: str(m.get('type')) ?? 'string',
    label: str(m.get('display_text')) ?? name,
    ...(token !== undefined ? { token } : {}),
    optional: flags.includes('optional'),
    multiple: flags.includes('multiple'),
    multipleToken: flags.includes('multiple_token'),
    ...(since !== undefined ? { since } : {}),
    arguments: sub,
  };
}

function docFromMap(name: string, m: Map<string, Tree>): CommandDoc {
  const subcommands: Record<string, CommandDoc> = {};
  const subs = mapOf(m.get('subcommands'));
  if (subs)
    for (const [subName, v] of subs) {
      const sm = mapOf(v);
      if (sm) subcommands[subName] = docFromMap(subName, sm);
    }
  const since = str(m.get('since'));
  const group = str(m.get('group'));
  const complexity = str(m.get('complexity'));
  const deprecatedSince = str(m.get('deprecated_since'));
  return {
    name,
    summary: str(m.get('summary')) ?? '',
    ...(since !== undefined ? { since } : {}),
    ...(group !== undefined ? { group } : {}),
    ...(complexity !== undefined ? { complexity } : {}),
    ...(deprecatedSince !== undefined ? { deprecatedSince } : {}),
    arguments: list(m.get('arguments'))
      .map(argFromTree)
      .filter((a): a is ArgDoc => a !== null),
    subcommands,
  };
}

/** One command's documentation (the value half of a `COMMAND DOCS` entry), or null when it is not a map. */
export function docFromTree(name: string, t: Tree | undefined): CommandDoc | null {
  const m = mapOf(t);
  return m ? docFromMap(name.toLowerCase(), m) : null;
}

/** The text POST /api/cli returns for `COMMAND DOCS a b c`, as one doc per name asked for. */
export function docsFromCliText(text: string): Record<string, CommandDoc> {
  const r = parseReply(text);
  return r.kind === 'array' ? docsFromReplyTree(treeFromReply(r) as Tree[]) : {};
}

/** A `COMMAND DOCS a b` reply as a tree: [name, map, name, map, ...]. */
export function docsFromReplyTree(reply: Tree[]): Record<string, CommandDoc> {
  const out: Record<string, CommandDoc> = {};
  for (let i = 0; i + 1 < reply.length; i += 2) {
    const name = reply[i];
    if (typeof name !== 'string') continue;
    const doc = docFromTree(name, reply[i + 1]);
    if (doc) out[name.toLowerCase()] = doc;
  }
  return out;
}

export function namesFromCliText(text: string): string[] {
  const r = parseReply(text);
  if (r.kind !== 'array') return [];
  return r.v.flatMap((x) => (x.kind === 'str' || x.kind === 'status' ? [x.v] : []));
}

// ---- scope ----------------------------------------------------------------------------------------------------

/**
 * Redis 8 ships modules (search, JSON, time series, probabilistic, vector sets) inside the same server, and
 * `COMMAND LIST` returns their commands too. A core command is lowercase with no dot in this server's list; module
 * commands keep the case their module registered (`FT.SEARCH`, `VADD`) or carry a dot (`ts.info`, `json.forget`),
 * and internal ones start with an underscore. The game teaches core Redis, so completion skips those names. This
 * is a scope filter over the server's own list, not a table of commands. The authoritative check runs when a
 * command's docs arrive: the server says `group: module` for every one of them (see `isModuleDoc`).
 */
export function isCoreName(name: string): boolean {
  return name === name.toLowerCase() && !name.includes('.') && !name.startsWith('_');
}

export function isModuleDoc(doc: CommandDoc): boolean {
  return doc.group === 'module';
}

// ---- sources --------------------------------------------------------------------------------------------------

/** Where names and docs come from. Both reject (never throw synchronously) when the data cannot be had right now. */
export interface DocsSource {
  names(): Promise<string[]>;
  /** Documentation for the given lowercase names, keyed by name. A missing key means the server has no such command. */
  docs(names: string[]): Promise<Record<string, CommandDoc>>;
}

/** Why a source could not answer; the store retries later and the UI shows nothing in the meantime. */
export class DocsUnavailable extends Error {}

async function getJson(url: string): Promise<Record<string, unknown>> {
  let res: Response;
  try {
    res = await fetch(url, { headers: { accept: 'application/json' } });
  } catch {
    throw new DocsUnavailable('engine unreachable');
  }
  if (!res.ok) throw new DocsUnavailable(`HTTP ${res.status}`);
  try {
    return (await res.json()) as Record<string, unknown>;
  } catch {
    throw new DocsUnavailable('not json');
  }
}

/**
 * The proposed read-only engine endpoints (not built yet, see the handoff):
 *   GET /api/command-docs/names      -> { names: string[] }   the server's COMMAND LIST, verbatim
 *   GET /api/command-docs?names=a,b  -> { reply: [...] }      the server's COMMAND DOCS a b reply, as the nested
 *                                                             arrays Redis sends (a map is a flat [key, value, ...]
 *                                                             array; verify/reply.ts `normalizeReply` makes this)
 * and an answer of { available: false } with status 200 while Redis is down (a 4xx or 5xx would be logged by the
 * browser as a console error). `GET /health` carries `commandDocs: true` when the endpoints exist, so a UI that is
 * newer than its engine asks nothing and logs nothing. The engine answers both from a snapshot taken once when
 * Redis first comes up, so serving them never touches Redis (and never shows in `INFO commandstats`).
 */
export const engineSource: DocsSource = {
  async names() {
    const gate = await getJson('/health');
    if (gate.commandDocs !== true) throw new DocsUnavailable('engine has no command-docs endpoint');
    const j = await getJson('/api/command-docs/names');
    if (j.available === false || !Array.isArray(j.names))
      throw new DocsUnavailable('redis is down');
    return j.names.filter((n): n is string => typeof n === 'string');
  },
  async docs(names) {
    const j = await getJson(`/api/command-docs?names=${encodeURIComponent(names.join(','))}`);
    if (j.available === false || !Array.isArray(j.reply))
      throw new DocsUnavailable('redis is down');
    return docsFromReplyTree(j.reply as Tree[]);
  },
};

/**
 * The same data over POST /api/cli. NOT the default: every call is a real command on the learner's Redis
 * (`cmdstat_command|docs` in `INFO commandstats`, a `redis_busy` event if a script is running). Kept so the owner
 * can choose to accept that with one line in `activeSource`.
 */
export function cliSource(
  run: (command: string) => Promise<{ reply: string; type: string }>,
): DocsSource {
  const ask = async (command: string) => {
    let r: { reply: string; type: string };
    try {
      r = await run(command);
    } catch {
      throw new DocsUnavailable('engine unreachable');
    }
    if (r.type === 'error') throw new DocsUnavailable(r.reply);
    return r.reply;
  };
  return {
    names: async () => namesFromCliText(await ask('COMMAND LIST')),
    docs: async (names) => docsFromCliText(await ask(`COMMAND DOCS ${names.join(' ')}`)),
  };
}

// ---- the store ------------------------------------------------------------------------------------------------

export type DocState = CommandDoc | 'missing' | undefined;

interface StoreOptions {
  /** How long to wait before asking again after a failure. */
  retryMs?: number;
  /** Docs requests are grouped for this long, so a popup of eight rows is one request. */
  batchMs?: number;
}

/**
 * Names once per session, docs per command on first need, both cached. Failures are quiet: nothing is cached for
 * longer than `retryMs`, and the UI simply has no popup while the data is missing.
 */
export class DocsStore {
  private nameList: string[] | null = null;
  private nameSet = new Set<string>();
  private docMap = new Map<string, CommandDoc | 'missing'>();
  private pending = new Set<string>();
  private inFlight = new Set<string>();
  private namesAsked = false;
  private namesRetryAt = 0;
  private docsRetryAt = 0;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private listeners = new Set<() => void>();
  private ver = 0;
  private readonly retryMs: number;
  private readonly batchMs: number;

  constructor(
    private source: DocsSource,
    opts: StoreOptions = {},
    private now: () => number = Date.now,
  ) {
    this.retryMs = opts.retryMs ?? 15_000;
    this.batchMs = opts.batchMs ?? 12;
  }

  /** Changes whenever names or docs change; the snapshot for useSyncExternalStore. */
  version = (): number => this.ver;

  subscribe = (fn: () => void): (() => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };

  private bump() {
    this.ver++;
    for (const l of this.listeners) l();
  }

  /** Names of every command and subcommand, or null while unknown. */
  names(): readonly string[] | null {
    return this.nameList;
  }

  has(name: string): boolean {
    return this.nameSet.has(name.toLowerCase());
  }

  /** Starts loading the names if that has not happened (or failed long enough ago). Safe to call on every render. */
  ensureNames(): void {
    if (this.nameList || this.namesAsked) return;
    if (this.now() < this.namesRetryAt) return;
    this.namesAsked = true;
    void this.source.names().then(
      (names) => {
        this.nameList = names;
        this.nameSet = new Set(names.map((n) => n.toLowerCase()));
        this.bump();
      },
      () => {
        this.namesAsked = false;
        this.namesRetryAt = this.now() + this.retryMs;
      },
    );
  }

  /** What is known about one command: its doc, 'missing' if the server has none, undefined if not loaded yet. */
  doc(name: string): DocState {
    return this.docMap.get(name.toLowerCase());
  }

  /** Asks for the docs of these commands unless they are known or on their way. */
  want(names: readonly string[]): void {
    let added = false;
    for (const raw of names) {
      const n = raw.toLowerCase();
      if (n.includes('|')) continue; // a subcommand's doc is inside its parent's
      if (this.docMap.has(n) || this.inFlight.has(n) || this.pending.has(n)) continue;
      this.pending.add(n);
      added = true;
    }
    if (added && !this.timer && this.now() >= this.docsRetryAt)
      this.timer = setTimeout(() => this.flush(), this.batchMs);
  }

  private flush() {
    this.timer = null;
    const batch = [...this.pending].slice(0, 20);
    for (const n of batch) {
      this.pending.delete(n);
      this.inFlight.add(n);
    }
    if (batch.length === 0) return;
    void this.source.docs(batch).then(
      (docs) => {
        for (const n of batch) {
          this.inFlight.delete(n);
          this.docMap.set(n, docs[n] ?? 'missing');
        }
        this.bump();
        if (this.pending.size) this.timer = setTimeout(() => this.flush(), this.batchMs);
      },
      () => {
        for (const n of batch) this.inFlight.delete(n);
        this.docsRetryAt = this.now() + this.retryMs;
      },
    );
  }

  /** Forget a failure so the next call asks again (the stack came back, the target changed). */
  retryNow(): void {
    this.namesRetryAt = 0;
    this.docsRetryAt = 0;
  }

  /** A different Redis may have different commands: start over. */
  reset(): void {
    this.nameList = null;
    this.nameSet = new Set();
    this.docMap.clear();
    this.pending.clear();
    this.namesAsked = false;
    this.retryNow();
    this.bump();
  }

  /** Test seam. */
  seed(names: string[], docs: Record<string, CommandDoc> = {}): void {
    this.nameList = names;
    this.nameSet = new Set(names.map((n) => n.toLowerCase()));
    for (const [k, v] of Object.entries(docs)) this.docMap.set(k.toLowerCase(), v);
    this.bump();
  }
}

// One store for the whole session (module scope outlives the panel, so moving between screens keeps the cache).
let active: DocsStore | null = null;

export function docsStore(): DocsStore {
  active ??= new DocsStore(engineSource);
  return active;
}

/** Tests and the owner's one-line switch: replace the session store. */
export function setDocsSource(source: DocsSource | null, opts?: StoreOptions): DocsStore | null {
  active = source ? new DocsStore(source, opts) : null;
  return active;
}
