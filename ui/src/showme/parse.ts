// Pure parsers for the replies the F-13 panels read. They take the Reply the redisReply parser built from the
// terminal text, so unit tests feed them the same text a learner would see in redis-cli.
import { asList, asNumber, asString, asStrings } from '../redisReply';
import type { Reply } from '../redisReply';

/** A flat [name, value, name, value] reply (XINFO, TS.INFO, BF.INFO, FT.INFO) as a lookup of the raw values. */
export function flatInfo(r: Reply | null | undefined): Map<string, Reply> {
  const l = asList(r);
  const out = new Map<string, Reply>();
  for (let i = 0; i + 1 < l.length; i += 2) {
    const k = asString(l[i]);
    if (k !== null) out.set(k.toLowerCase(), l[i + 1] as Reply);
  }
  return out;
}

const num = (m: Map<string, Reply>, k: string): number | null => asNumber(m.get(k));

/** Redis answers a missing key or index with an error; the panels turn exactly these into their empty state. */
export function isMissingError(error: string | null): boolean {
  return (
    error !== null &&
    /no such key|not found|does not exist|unknown index name|no such index|unknown index/i.test(
      error,
    )
  );
}

// ---- stream_groups ---------------------------------------------------------------------------------------
export interface StreamGroup {
  name: string;
  consumers: number;
  pending: number;
  /** null when Redis cannot tell (XINFO GROUPS answers nil). */
  lag: number | null;
  lastDeliveredId: string;
}

/** XINFO GROUPS <key>: one flat array per group. */
export function parseStreamGroups(r: Reply | null | undefined): StreamGroup[] {
  return asList(r).map((g) => {
    const m = flatInfo(g);
    return {
      name: asString(m.get('name')) ?? '?',
      consumers: num(m, 'consumers') ?? 0,
      pending: num(m, 'pending') ?? 0,
      lag: num(m, 'lag'),
      lastDeliveredId: asString(m.get('last-delivered-id')) ?? '',
    };
  });
}

/** XPENDING <key> <group> (summary form): [count, min id, max id, [[consumer, count], ...]] with nils when empty. */
export function parsePendingByConsumer(
  r: Reply | null | undefined,
): { consumer: string; pending: number }[] {
  const consumers = asList(asList(r)[3]);
  return consumers.flatMap((c) => {
    const [name, n] = asList(c);
    const consumer = asString(name);
    return consumer === null ? [] : [{ consumer, pending: asNumber(n) ?? 0 }];
  });
}

// ---- ts_chart --------------------------------------------------------------------------------------------
export interface TsInfo {
  retentionMs: number;
  totalSamples: number;
  labels: [string, string][];
}

/** TS.INFO: retentionTime and totalSamples are flat fields, labels is an array of [name, value] arrays. */
export function parseTsInfo(r: Reply | null | undefined): TsInfo {
  const m = flatInfo(r);
  return {
    retentionMs: num(m, 'retentiontime') ?? 0,
    totalSamples: num(m, 'totalsamples') ?? 0,
    labels: asList(m.get('labels')).flatMap((p) => {
      const [k, v] = asStrings(p);
      return k === undefined ? [] : [[k, v ?? ''] as [string, string]];
    }),
  };
}

/** TS.RANGE ... AGGREGATION avg: [[timestamp, value], ...]; only the last `n` buckets are kept. */
export function parseTsRange(r: Reply | null | undefined, n = 60): { ts: number; value: number }[] {
  const rows = asList(r).flatMap((p) => {
    const [ts, v] = asList(p);
    const t = asNumber(ts);
    const value = asNumber(v);
    return t === null || value === null ? [] : [{ ts: t, value }];
  });
  return rows.slice(-n);
}

// ---- bf_card ---------------------------------------------------------------------------------------------
export interface BfInfo {
  capacity: number | null;
  sizeBytes: number | null;
  filters: number | null;
  inserted: number | null;
  /** null when the filter is non-scaling (BF.INFO answers nil). */
  expansion: number | null;
}

export function parseBfInfo(r: Reply | null | undefined): BfInfo {
  const m = flatInfo(r);
  return {
    capacity: num(m, 'capacity'),
    sizeBytes: num(m, 'size'),
    filters: num(m, 'number of filters'),
    inserted: num(m, 'number of items inserted'),
    expansion: num(m, 'expansion rate'),
  };
}

// ---- ft_card ---------------------------------------------------------------------------------------------
export interface FtInfo {
  numDocs: number;
  prefixes: string[];
  fields: { name: string; type: string }[];
}

/** FT.INFO: num_docs, index_definition (flat, with prefixes) and attributes (one flat array per field). */
export function parseFtInfo(r: Reply | null | undefined): FtInfo {
  const m = flatInfo(r);
  const def = flatInfo(m.get('index_definition'));
  const attrs = asList(m.get('attributes') ?? m.get('fields'));
  return {
    numDocs: num(m, 'num_docs') ?? 0,
    prefixes: asStrings(def.get('prefixes')),
    fields: attrs.flatMap((a) => {
      const l = asStrings(a);
      const at = l.indexOf('attribute');
      const id = l.indexOf('identifier');
      const ty = l.indexOf('type');
      const name = at >= 0 ? l[at + 1] : id >= 0 ? l[id + 1] : l[0];
      return name === undefined ? [] : [{ name, type: ty >= 0 ? (l[ty + 1] ?? '') : '' }];
    }),
  };
}

/** FT.SEARCH <idx> * LIMIT 0 3 RETURN 0: [total, id, id, id]. */
export function parseFtIds(r: Reply | null | undefined): string[] {
  return asStrings({ kind: 'array', v: asList(r).slice(1) });
}

// ---- acl_users -------------------------------------------------------------------------------------------
export interface AclUser {
  name: string;
  rules: string;
}

/** ACL LIST: "user <name> <rules...>" per line; the default user first, the rest in the order Redis gave. */
export function parseAclList(r: Reply | null | undefined): AclUser[] {
  const users = asStrings(r).flatMap((line) => {
    const m = /^user (\S+)(?: (.*))?$/.exec(line.trim());
    return m ? [{ name: m[1] as string, rules: m[2] ?? '' }] : [];
  });
  return [
    ...users.filter((u) => u.name === 'default'),
    ...users.filter((u) => u.name !== 'default'),
  ];
}
