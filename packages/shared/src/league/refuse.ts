// Which commands an entry (and a hole's setup) may not contain. The list is a denylist on purpose: a hole is about
// Redis's data commands, and an entry that reaches for a script, a configuration change or another database
// would either make the score meaningless or touch the player's own data.

/** Command name (upper case, first word only) to the reason shown to a contributor. */
export const REFUSED_COMMANDS: Readonly<Record<string, string>> = {
  // Named by the spec: they make a command count pointless (one script can do anything).
  EVAL: 'scripts make the command count meaningless',
  EVALSHA: 'scripts make the command count meaningless',
  EVAL_RO: 'scripts make the command count meaningless',
  EVALSHA_RO: 'scripts make the command count meaningless',
  FCALL: 'functions make the command count meaningless',
  FCALL_RO: 'functions make the command count meaningless',
  FUNCTION: 'functions make the command count meaningless',
  SCRIPT: 'scripts make the command count meaningless',
  DEBUG: 'DEBUG is not a data command',
  FLUSHALL: 'scoring empties its own database first; FLUSHALL would reach every database',
  CONFIG: 'an entry may not change the server',
  // Anything that could move an entry out of the scratch database, which would put it in the player's own data.
  FLUSHDB: 'scoring empties the scratch database itself',
  SELECT: 'an entry runs in the scratch database and may not switch databases',
  SWAPDB: 'an entry may not swap databases',
  MOVE: 'an entry may not move keys between databases',
  MIGRATE: 'an entry may not send keys to another server',
  RESET: 'RESET would switch the connection back to database 0',
  HELLO: 'an entry may not change the connection',
  AUTH: 'an entry may not change the connection',
  CLIENT: 'an entry may not change the connection',
  QUIT: 'an entry may not close the connection',
  // Server-wide side effects.
  SHUTDOWN: 'an entry may not stop the server',
  SAVE: 'an entry may not write snapshots',
  BGSAVE: 'an entry may not write snapshots',
  BGREWRITEAOF: 'an entry may not rewrite the append-only file',
  REPLICAOF: 'an entry may not change replication',
  SLAVEOF: 'an entry may not change replication',
  FAILOVER: 'an entry may not fail the server over',
  ACL: 'an entry may not change users',
  CLUSTER: 'an entry may not change the cluster',
  // One entry line is one command: no transactions, and nothing that waits for another client.
  MULTI: 'one line is one command; transactions are not scored',
  EXEC: 'one line is one command; transactions are not scored',
  DISCARD: 'one line is one command; transactions are not scored',
  WATCH: 'one line is one command; transactions are not scored',
  UNWATCH: 'one line is one command; transactions are not scored',
  MONITOR: 'it never returns',
  SUBSCRIBE: 'it never returns',
  PSUBSCRIBE: 'it never returns',
  SSUBSCRIBE: 'it never returns',
  SYNC: 'it never returns',
  PSYNC: 'it never returns',
  WAIT: 'it waits for replicas that scoring does not have',
  WAITAOF: 'it waits for persistence that scoring does not use',
  BLPOP: 'blocking commands wait for another client',
  BRPOP: 'blocking commands wait for another client',
  BLMOVE: 'blocking commands wait for another client',
  BRPOPLPUSH: 'blocking commands wait for another client',
  BLMPOP: 'blocking commands wait for another client',
  BZPOPMIN: 'blocking commands wait for another client',
  BZPOPMAX: 'blocking commands wait for another client',
  BZMPOP: 'blocking commands wait for another client',
};

/** `null` when the command may run, otherwise a sentence that says why not. */
export function refusalFor(argv: readonly string[]): string | null {
  const name = (argv[0] ?? '').toUpperCase();
  if (name === '') return 'the command is empty';
  const why = REFUSED_COMMANDS[name];
  if (why !== undefined) return `${name} is not allowed: ${why}`;
  // COPY and its DB option write into another database.
  if (name === 'COPY' && argv.slice(3).some((a) => a.toUpperCase() === 'DB')) {
    return 'COPY ... DB is not allowed: an entry may not write into another database';
  }
  return null;
}
