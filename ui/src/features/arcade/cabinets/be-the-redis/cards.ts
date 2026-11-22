// The command cards of "Be the Redis": which commands can arrive, how many ticks one takes, and the deck built from
// the server's own documentation.
//
// What is the server's and what is ours:
//   * `summary` and `complexity` on a card are the server's words (COMMAND DOCS, served by the engine; the terminal's
//     reader in src/terminal/docs.ts fetches them). Offline there is a verbatim copy, FALLBACK_INFO.
//   * The number of ticks a command takes is OUR model, derived from that complexity text and the size of the key.
//     It is a simulation, not a measurement, and the cabinet says so (see facts.ts, rules R5 and R6).

export interface CommandInfo {
  summary: string;
  complexity: string;
}

export type CostClass = 'constant' | 'log' | 'linear' | 'unknown';

/** Real milliseconds per game tick: one tick is a tenth of a second of game time. */
export const TICK_MS = 100;
/** How many items a command walks in one tick. The game's number, not Redis's. */
export const WORK_PER_TICK = 100;
/** The longest any one command can hold Redis, in ticks. */
export const MAX_TICKS = 60;
/** Items covered by one cursor call of an incremental command (SCAN and its cousins). The game's number. */
export const PAGE_ITEMS = 500;
/** A command that holds Redis this long counts as slow. */
export const HEAVY_TICKS = 10;

/**
 * The first bound in a complexity text: `O(1)`, `O(log(N))`, `O(N)`, `O(S+N)`. Only the first one counts, so
 * "O(1) for each field/value pair added, so O(N) to add N pairs" is constant. Anything without an `O(` is unknown.
 */
export function costClassOf(complexity: string): CostClass {
  const m = /o\(\s*([^)]*)/i.exec(complexity);
  if (!m) return 'unknown';
  const inner = (m[1] ?? '').trim().toLowerCase();
  if (inner === '1') return 'constant';
  if (inner.startsWith('log')) return 'log';
  if (/[nsm]/.test(inner)) return 'linear';
  return 'unknown';
}

/** Ticks one call holds Redis, for a key of `size` items. At least 1, at most MAX_TICKS. */
export function costTicks(cls: CostClass, size: number): number {
  const n = Math.max(0, Math.floor(size));
  switch (cls) {
    case 'constant':
    case 'unknown':
      return 1;
    case 'log':
      return Math.min(4, Math.max(1, Math.ceil(Math.log2(n + 1) / 6)));
    case 'linear':
      return Math.min(MAX_TICKS, Math.max(1, Math.ceil(n / WORK_PER_TICK)));
  }
}

export interface Unit {
  one: string;
  many: string;
}

/** A command that can arrive. `command` is the lowercase name the server's docs are filed under. */
export interface Template {
  command: string;
  /** What the card shows after the command name. */
  args: string;
  unit: Unit;
  /** The size of the key it touches is drawn from [min, max]. */
  min: number;
  max: number;
  weight: number;
  /** The incremental form offered as a swap. */
  cousin?: { command: string; args: string };
}

const KEY: Unit = { one: 'key', many: 'keys' };

/**
 * The commands of the game, cheap first. Weights keep slow ones to roughly one client in eight. Sizes are the game's
 * (a key "of N items" is a stage prop); which commands walk the whole key is the docs' (docs/handoffs/D-08.md, R4).
 */
export const TEMPLATES: readonly Template[] = [
  {
    command: 'get',
    args: 'session:418',
    unit: { one: 'byte', many: 'bytes' },
    min: 40,
    max: 900,
    weight: 5,
  },
  {
    command: 'set',
    args: 'session:77',
    unit: { one: 'byte', many: 'bytes' },
    min: 40,
    max: 900,
    weight: 3,
  },
  { command: 'expire', args: 'cart:9120 3600', unit: KEY, min: 1, max: 1, weight: 2 },
  {
    command: 'hset',
    args: 'user:42 city Pune',
    unit: { one: 'field', many: 'fields' },
    min: 5,
    max: 30,
    weight: 2,
  },
  {
    command: 'hget',
    args: 'user:42 city',
    unit: { one: 'field', many: 'fields' },
    min: 5,
    max: 30,
    weight: 3,
  },
  { command: 'incr', args: 'counter:visits', unit: KEY, min: 1, max: 1, weight: 2 },
  {
    command: 'zadd',
    args: 'leaderboard 120 asha',
    unit: { one: 'member', many: 'members' },
    min: 500,
    max: 20000,
    weight: 2,
  },
  {
    command: 'xadd',
    args: 'events:match * type six',
    unit: { one: 'entry', many: 'entries' },
    min: 1000,
    max: 50000,
    weight: 1,
  },
  {
    command: 'keys',
    args: '*',
    unit: { one: 'key in the database', many: 'keys in the database' },
    min: 2000,
    max: 6000,
    weight: 1.2,
    cousin: { command: 'scan', args: '0 COUNT 500' },
  },
  {
    command: 'hgetall',
    args: 'stats:season',
    unit: { one: 'field', many: 'fields' },
    min: 1500,
    max: 5000,
    weight: 1.2,
    cousin: { command: 'hscan', args: 'stats:season 0 COUNT 500' },
  },
  {
    command: 'smembers',
    args: 'fans:all',
    unit: { one: 'member', many: 'members' },
    min: 2000,
    max: 6000,
    weight: 1.2,
    cousin: { command: 'sscan', args: 'fans:all 0 COUNT 500' },
  },
  {
    command: 'lrange',
    args: 'feed:global 0 -1',
    unit: { one: 'item', many: 'items' },
    min: 1500,
    max: 4500,
    weight: 1,
  },
  {
    command: 'lpos',
    args: 'queue:emails mail-9',
    unit: { one: 'item', many: 'items' },
    min: 1500,
    max: 3000,
    weight: 1,
  },
];

/**
 * A verbatim copy of the server's `COMMAND DOCS` summary and complexity for the nine commands F-22 captured from
 * redis:8 (ui/test/terminal.fixtures.ts). Used only when the engine's docs are not available. Not edited, not
 * paraphrased: a test compares it with the fixtures.
 */
export const FALLBACK_INFO: Readonly<Record<string, CommandInfo>> = {
  get: { summary: 'Returns the string value of a key.', complexity: 'O(1)' },
  set: {
    summary:
      "Sets the string value of a key, ignoring its type. The key is created if it doesn't exist.",
    complexity: 'O(1)',
  },
  hset: {
    summary: 'Creates or modifies the value of a field in a hash.',
    complexity:
      'O(1) for each field/value pair added, so O(N) to add N field/value pairs when the command is called with multiple field/value pairs.',
  },
  zadd: {
    summary:
      "Adds one or more members to a sorted set, or updates their scores. Creates the key if it doesn't exist.",
    complexity:
      'O(log(N)) for each item added, where N is the number of elements in the sorted set.',
  },
  xadd: {
    summary: "Appends a new message to a stream. Creates the key if it doesn't exist.",
    complexity:
      'O(1) when adding a new entry, O(N) when trimming where N being the number of entries evicted.',
  },
  expire: { summary: 'Sets the expiration time of a key in seconds.', complexity: 'O(1)' },
  keys: {
    summary: 'Returns all key names that match a pattern.',
    complexity:
      'O(N) with N being the number of keys in the database, under the assumption that the key names in the database and the given pattern have limited length.',
  },
  lpos: {
    summary: 'Returns the index of matching elements in a list.',
    complexity:
      'O(N) where N is the number of elements in the list, for the average case. When searching for elements near the head or the tail of the list, or when the MAXLEN option is provided, the command may run in constant time.',
  },
  scan: {
    summary: 'Iterates over the key names in the database.',
    complexity:
      'O(1) for every call. O(N) for a complete iteration, including enough command calls for the cursor to return back to 0. N is the number of elements inside the collection.',
  },
};

/** A card of the deck: a template with the server's words on it. */
export interface DeckCard {
  /** The template's `command`, lowercase, unique in a deck. */
  id: string;
  /** Upper case, as a player types it. */
  command: string;
  args: string;
  unit: Unit;
  min: number;
  max: number;
  weight: number;
  info: CommandInfo;
  cousin?: { command: string; args: string; info: CommandInfo };
}

export interface Deck {
  cards: readonly DeckCard[];
  /** Where the words on the cards came from. */
  source: 'server' | 'fallback';
}

/** What the docs reader knows about a command: its words, 'missing' (the server has none) or nothing yet. */
export type InfoLookup = (name: string) => CommandInfo | 'missing' | undefined;

/** Every command name the deck may need, including the incremental cousins: what to ask the server for. */
export function wantedNames(): string[] {
  const names = new Set<string>();
  for (const t of TEMPLATES) {
    names.add(t.command);
    if (t.cousin) names.add(t.cousin.command);
  }
  return [...names];
}

function cardsFrom(
  lookup: (name: string) => CommandInfo | undefined,
  templates: readonly Template[],
): DeckCard[] {
  const cards: DeckCard[] = [];
  for (const t of templates) {
    const info = lookup(t.command);
    if (!info) continue;
    const cousinInfo = t.cousin ? lookup(t.cousin.command) : undefined;
    cards.push({
      id: t.command,
      command: t.command.toUpperCase(),
      args: t.args,
      unit: t.unit,
      min: t.min,
      max: t.max,
      weight: t.weight,
      info,
      ...(t.cousin && cousinInfo
        ? {
            cousin: {
              command: t.cousin.command.toUpperCase(),
              args: t.cousin.args,
              info: cousinInfo,
            },
          }
        : {}),
    });
  }
  return cards;
}

/** The deck built from the copy of the server's words that ships with the game. */
export function fallbackDeck(): Deck {
  return { cards: cardsFrom((n) => FALLBACK_INFO[n], TEMPLATES), source: 'fallback' };
}

/**
 * The deck from the live server when every command it needs has been answered (a command the server does not know
 * is simply left out, but at least six must be there and at least one must be slow); otherwise the fallback deck.
 * `lookup` is the docs reader's view, so a half-loaded answer never makes a half-live deck.
 */
export function chooseDeck(lookup: InfoLookup): Deck {
  for (const name of wantedNames()) if (lookup(name) === undefined) return fallbackDeck();
  const cards = cardsFrom((n) => {
    const v = lookup(n);
    return v === undefined || v === 'missing' ? undefined : v;
  }, TEMPLATES);
  const slow = cards.some((c) => costClassOf(c.info.complexity) === 'linear');
  return cards.length >= 6 && slow ? { cards, source: 'server' } : fallbackDeck();
}

/** "3,200 keys in the database", "1 key". */
export function describeSize(size: number, unit: Unit): string {
  return `${size.toLocaleString('en-US')} ${size === 1 ? unit.one : unit.many}`;
}
