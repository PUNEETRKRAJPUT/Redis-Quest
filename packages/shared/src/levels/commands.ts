// The read-only allowlist for verifier commands.
//
// Verifiers inspect the learner's Redis; they must never change it, or a verify run would
// alter the very state it grades (and re-running verify could flip the verdict). The rule is an
// allowlist, not a denylist: anything not named here is treated as a write, so a new or obscure
// command fails closed. A check that genuinely has to write opts out with `allowWrite: true`
// plus a `reason`, which keeps every exception visible in review.
//
// Deliberately excluded although read-only in Redis terms:
// - blocking or connection-stateful commands (XREAD with BLOCK, SUBSCRIBE, MONITOR, WAIT):
//   a verifier must return promptly and leave the connection reusable;
// - SORT (it has a STORE option; SORT_RO is allowed), SCRIPT LOAD (mutates the script cache),
//   EVAL/EVALSHA/FCALL (scripts can write; the _RO variants are allowed).

/** Commands whose meaning depends on the first argument; the key is "CMD SUBCMD". */
export const SUBCOMMAND_CONTAINERS: ReadonlySet<string> = new Set([
  'ACL',
  'CLIENT',
  'CLUSTER',
  'COMMAND',
  'CONFIG',
  'FUNCTION',
  'LATENCY',
  'MEMORY',
  'OBJECT',
  'PUBSUB',
  'SCRIPT',
  'SLOWLOG',
  'XINFO',
]);

export const READ_ONLY_COMMANDS: ReadonlySet<string> = new Set([
  // keyspace and server
  'DBSIZE', 'EXISTS', 'EXPIRETIME', 'INFO', 'KEYS', 'LASTSAVE', 'PEXPIRETIME', 'PING', 'PTTL',
  'RANDOMKEY', 'ROLE', 'SCAN', 'TIME', 'TTL', 'TYPE',
  'ACL CAT', 'ACL GETUSER', 'ACL LIST', 'ACL USERS', 'ACL WHOAMI',
  'CLIENT GETNAME', 'CLIENT ID', 'CLIENT INFO', 'CLIENT LIST',
  'CLUSTER COUNTKEYSINSLOT', 'CLUSTER INFO', 'CLUSTER KEYSLOT', 'CLUSTER MYID', 'CLUSTER NODES',
  'CLUSTER SHARDS', 'CLUSTER SLOTS',
  'COMMAND COUNT', 'COMMAND DOCS', 'COMMAND INFO',
  'CONFIG GET',
  'FUNCTION LIST',
  'LATENCY DOCTOR', 'LATENCY HISTORY', 'LATENCY LATEST',
  'MEMORY DOCTOR', 'MEMORY STATS', 'MEMORY USAGE',
  'OBJECT ENCODING', 'OBJECT FREQ', 'OBJECT IDLETIME', 'OBJECT REFCOUNT',
  'PUBSUB CHANNELS', 'PUBSUB NUMPAT', 'PUBSUB NUMSUB', 'PUBSUB SHARDCHANNELS', 'PUBSUB SHARDNUMSUB',
  'SCRIPT EXISTS',
  'SLOWLOG GET', 'SLOWLOG LEN',
  'EVAL_RO', 'EVALSHA_RO', 'FCALL_RO', 'SORT_RO',
  // strings and bitmaps
  'BITCOUNT', 'BITFIELD_RO', 'BITPOS', 'GET', 'GETBIT', 'GETRANGE', 'LCS', 'MGET', 'STRLEN', 'SUBSTR',
  // hashes
  'HEXISTS', 'HEXPIRETIME', 'HGET', 'HGETALL', 'HKEYS', 'HLEN', 'HMGET', 'HPEXPIRETIME', 'HPTTL',
  'HRANDFIELD', 'HSCAN', 'HSTRLEN', 'HTTL', 'HVALS',
  // lists
  'LINDEX', 'LLEN', 'LPOS', 'LRANGE',
  // sets
  'SCARD', 'SDIFF', 'SINTER', 'SINTERCARD', 'SISMEMBER', 'SMEMBERS', 'SMISMEMBER', 'SRANDMEMBER',
  'SSCAN', 'SUNION',
  // sorted sets
  'ZCARD', 'ZCOUNT', 'ZDIFF', 'ZINTER', 'ZINTERCARD', 'ZLEXCOUNT', 'ZMSCORE', 'ZRANDMEMBER', 'ZRANGE',
  'ZRANGEBYLEX', 'ZRANGEBYSCORE', 'ZRANK', 'ZREVRANGE', 'ZREVRANGEBYLEX', 'ZREVRANGEBYSCORE',
  'ZREVRANK', 'ZSCAN', 'ZSCORE', 'ZUNION',
  // streams
  'XINFO CONSUMERS', 'XINFO GROUPS', 'XINFO STREAM', 'XLEN', 'XPENDING', 'XRANGE', 'XREVRANGE',
  // geo, hyperloglog
  'GEODIST', 'GEOHASH', 'GEOPOS', 'GEOSEARCH', 'PFCOUNT',
  // JSON, search, probabilistic, time series (Redis 8 bundles these)
  'JSON.ARRLEN', 'JSON.GET', 'JSON.MGET', 'JSON.OBJKEYS', 'JSON.OBJLEN', 'JSON.STRLEN', 'JSON.TYPE',
  'FT.AGGREGATE', 'FT.EXPLAIN', 'FT.INFO', 'FT.SEARCH', 'FT._LIST',
  'BF.CARD', 'BF.EXISTS', 'BF.INFO', 'BF.MEXISTS',
  'CF.COUNT', 'CF.EXISTS', 'CF.INFO', 'CF.MEXISTS',
  'CMS.INFO', 'CMS.QUERY',
  'TOPK.INFO', 'TOPK.LIST', 'TOPK.QUERY',
  'TDIGEST.BYRANK', 'TDIGEST.BYREVRANK', 'TDIGEST.CDF', 'TDIGEST.INFO', 'TDIGEST.MAX', 'TDIGEST.MIN',
  'TDIGEST.QUANTILE', 'TDIGEST.RANK', 'TDIGEST.REVRANK', 'TDIGEST.TRIMMED_MEAN',
  'TS.GET', 'TS.INFO', 'TS.MGET', 'TS.MRANGE', 'TS.MREVRANGE', 'TS.QUERYINDEX', 'TS.RANGE', 'TS.REVRANGE',
]);

/** Commands that are refused in `setup` and fixtures because they would wipe the engine's own `game:*` keys. */
export const SETUP_FORBIDDEN_COMMANDS: ReadonlySet<string> = new Set(['FLUSHALL', 'FLUSHDB', 'SHUTDOWN']);

/** Normalised lookup key: `GET`, `CONFIG GET`, `JSON.GET`. */
export function commandKey(cmd: readonly string[]): string {
  const name = (cmd[0] ?? '').toUpperCase();
  if (SUBCOMMAND_CONTAINERS.has(name) && cmd.length > 1) {
    return `${name} ${(cmd[1] ?? '').toUpperCase()}`;
  }
  return name;
}

export function isReadOnlyCommand(cmd: readonly string[]): boolean {
  return READ_ONLY_COMMANDS.has(commandKey(cmd));
}
