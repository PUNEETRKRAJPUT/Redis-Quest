// E-03: where does a raw command's first key sit? On a cluster the engine has to hand node-redis the key so
// it can pick the slot. The answer comes from the server's own `COMMAND` table (the same reply the allowlist
// cross-check reads), never from a list kept in this repo.
//
// Each entry of `COMMAND` is [name, arity, flags, firstKey, lastKey, step, aclCategories, tips, keySpecs,
// subcommands]. `firstKey` is the 1-based position in the full argv (the command name is position 0); 0 means
// "no key at a fixed place". Commands flagged `movablekeys` (EVAL, XREAD, ZUNIONSTORE, SORT ...) have
// no fixed place, so those ask the server with COMMAND GETKEYS.

export interface KeyInfo {
  first: number;
  movable: boolean;
}

export type RawCommandReply = unknown;

function asText(v: unknown): string {
  return Buffer.isBuffer(v) ? v.toString('utf8') : String(v);
}

export class KeyTable {
  private readonly byName = new Map<string, KeyInfo>();

  get size(): number {
    return this.byName.size;
  }

  /** Reads the reply of `COMMAND` (no arguments), subcommands included (`object|encoding`). */
  load(reply: RawCommandReply): void {
    this.byName.clear();
    if (!Array.isArray(reply)) return;
    const visit = (entry: unknown): void => {
      if (!Array.isArray(entry) || entry.length < 6) return;
      const name = asText(entry[0]).toLowerCase();
      const flags = Array.isArray(entry[2]) ? entry[2].map((f) => asText(f).toLowerCase()) : [];
      this.byName.set(name, {
        first: Number(entry[3]) || 0,
        movable: flags.includes('movablekeys'),
      });
      if (Array.isArray(entry[9])) entry[9].forEach(visit);
    };
    reply.forEach(visit);
  }

  /** The entry that applies to `argv`: `cluster|keyslot` over `cluster`, `get` for GET; undefined if unknown. */
  lookup(argv: readonly string[]): KeyInfo | undefined {
    const name = (argv[0] ?? '').toLowerCase();
    if (argv.length > 1) {
      const sub = this.byName.get(`${name}|${String(argv[1]).toLowerCase()}`);
      if (sub) return sub;
    }
    return this.byName.get(name);
  }

  /**
   * The first key of `argv`, `null` when the command has none at a fixed place and is not movable, and
   * `'movable'` when the server must be asked (COMMAND GETKEYS). Unknown commands have no key.
   */
  firstKey(argv: readonly string[]): string | null | 'movable' {
    const info = this.lookup(argv);
    if (!info) return null;
    if (info.movable) return 'movable';
    if (info.first <= 0) return null;
    const k = argv[info.first];
    return k === undefined ? null : k;
  }
}
