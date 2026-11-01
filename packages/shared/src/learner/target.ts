// One parser and one client factory for every Redis target kind (E-03). The engine, the app and the
// runner all read the same target string, so a learner who switches to a replica, a Sentinel pair or a
// cluster is followed by every process with the same rules.
//
//   redis://host:port[/db]   rediss://...   (single node)
//   sentinel://<masterName>@host1:port1,host2:port2,host3:port3
//   cluster://host1:port1,host2:port2[,...]
import { createClient, createCluster, createSentinel } from 'redis';

export type TargetKind = 'single' | 'sentinel' | 'cluster';

export interface ParsedTarget {
  kind: TargetKind;
  url: string;
  masterName?: string;
  nodes: { host: string; port: number }[];
}

export class TargetError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TargetError';
  }
}

const DEFAULT_PORTS: Record<string, number> = { sentinel: 26379, cluster: 6379 };

function parseNodeList(list: string, scheme: string): { host: string; port: number }[] {
  const nodes = list
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
    .map((entry) => {
      const idx = entry.lastIndexOf(':');
      const host = idx === -1 ? entry : entry.slice(0, idx);
      const portText = idx === -1 ? String(DEFAULT_PORTS[scheme]) : entry.slice(idx + 1);
      if (host === '' || /[\s/@]/.test(host)) throw new TargetError(`bad host in "${entry}"`);
      if (!/^\d+$/.test(portText)) throw new TargetError(`bad port in "${entry}"`);
      const port = Number(portText);
      if (port < 1 || port > 65535) throw new TargetError(`port out of range in "${entry}"`);
      return { host, port };
    });
  if (nodes.length === 0) throw new TargetError(`${scheme}:// needs at least one host:port`);
  return nodes;
}

export function parseTarget(url: string): ParsedTarget {
  const raw = typeof url === 'string' ? url.trim() : '';
  const m = /^([a-z]+):\/\/(.*)$/i.exec(raw);
  if (!m) throw new TargetError('expected redis://, rediss://, sentinel:// or cluster://');
  const scheme = m[1]!.toLowerCase();
  const rest = m[2]!;
  if (scheme === 'redis' || scheme === 'rediss') {
    let u: URL;
    try {
      u = new URL(raw);
    } catch {
      throw new TargetError('not a valid redis URL');
    }
    if (u.hostname === '') throw new TargetError('redis URL needs a host');
    const port = u.port === '' ? 6379 : Number(u.port);
    return { kind: 'single', url: raw, nodes: [{ host: u.hostname, port }] };
  }
  if (scheme === 'sentinel') {
    const at = rest.indexOf('@');
    if (at <= 0) throw new TargetError('sentinel:// needs <masterName>@host:port,...');
    const masterName = rest.slice(0, at);
    if (/[\s,/:]/.test(masterName)) throw new TargetError(`bad master name "${masterName}"`);
    return {
      kind: 'sentinel',
      url: raw,
      masterName,
      nodes: parseNodeList(rest.slice(at + 1), 'sentinel'),
    };
  }
  if (scheme === 'cluster') {
    return { kind: 'cluster', url: raw, nodes: parseNodeList(rest, 'cluster') };
  }
  throw new TargetError(`unsupported scheme "${scheme}://"`);
}

export function describeTarget(t: ParsedTarget): string {
  const plural = (n: number, w: string): string => `${n} ${w}${n === 1 ? '' : 's'}`;
  switch (t.kind) {
    case 'single': {
      const n = t.nodes[0]!;
      return `single node ${n.host}:${n.port}`;
    }
    case 'sentinel':
      return `sentinel ${t.masterName ?? ''} via ${plural(t.nodes.length, 'sentinel')}`;
    case 'cluster':
      return `cluster, ${plural(t.nodes.length, 'root node')}`;
  }
}

export interface TargetClientOptions {
  disableOfflineQueue?: boolean;
  connectTimeoutMs?: number;
  reconnectStrategy?: (retries: number) => number | Error;
  RESP?: 2 | 3;
  clientSideCache?: unknown;
  name?: string;
}

export type TargetClient =
  | ReturnType<typeof createClient>
  | ReturnType<typeof createCluster>
  | ReturnType<typeof createSentinel>;

const kinds = new WeakMap<object, TargetKind>();

// The per-node options shared by all three kinds. Built loosely typed on purpose: the three client
// option types differ in generics but accept this same subset.
function nodeOptions(opts: TargetClientOptions): Record<string, unknown> {
  const o: Record<string, unknown> = {};
  if (opts.disableOfflineQueue !== undefined) o.disableOfflineQueue = opts.disableOfflineQueue;
  if (opts.name !== undefined) o.name = opts.name;
  const socket: Record<string, unknown> = {};
  if (opts.connectTimeoutMs !== undefined) socket.connectTimeout = opts.connectTimeoutMs;
  if (opts.reconnectStrategy !== undefined) socket.reconnectStrategy = opts.reconnectStrategy;
  if (Object.keys(socket).length > 0) o.socket = socket;
  return o;
}

export function createTargetClient(t: ParsedTarget, opts: TargetClientOptions = {}): TargetClient {
  const node = nodeOptions(opts);
  const top: Record<string, unknown> = {};
  if (opts.RESP !== undefined) top.RESP = opts.RESP;
  if (opts.clientSideCache !== undefined) top.clientSideCache = opts.clientSideCache;
  // Every client is cast through `unknown` on purpose: letting the compiler check the three node-redis client
  // types against each other (the union below) costs about a second and 1 GB of tsc memory, enough to run a
  // small Docker build out of heap.
  let client: unknown;
  if (t.kind === 'single') {
    client = createClient({ url: t.url, ...node, ...top } as never);
  } else if (t.kind === 'sentinel') {
    client = createSentinel({
      name: t.masterName ?? 'mymaster',
      sentinelRootNodes: t.nodes,
      nodeClientOptions: node,
      sentinelClientOptions: node,
      ...top,
    } as never);
  } else {
    client = createCluster({
      rootNodes: t.nodes.map((n) => ({ socket: { host: n.host, port: n.port } })),
      defaults: node,
      ...top,
    } as never);
  }
  kinds.set(client as object, t.kind);
  return client as TargetClient;
}

export function isCluster(c: unknown): boolean {
  return typeof c === 'object' && c !== null && kinds.get(c) === 'cluster';
}

export function isSentinel(c: unknown): boolean {
  return typeof c === 'object' && c !== null && kinds.get(c) === 'sentinel';
}
