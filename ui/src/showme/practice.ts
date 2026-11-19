// "The nets": the practice gallery's own keys. Everything lives under `practice:` (no level file uses that prefix;
// `game:` stays the engine's). Created on demand with one button, removed with another; never on page load.
import { PRACTICE_PREFIX } from './commands';

const p = (name: string) => `${PRACTICE_PREFIX}${name}`;

/** The key each panel reads in the gallery; null for the panels that read the server, not a key. */
export const PRACTICE_KEYS = {
  kv_card: p('string'),
  hash_card: p('hash'),
  list_feed: p('list'),
  set_chips: p('set'),
  leaderboard_panel: p('board'),
  ttl_timer: p('ttl'),
  bitmap_streak: p('streak'),
  hll_counter: p('hll'),
  geo_map: p('geo'),
  stream_log: p('stream'),
  json_tree: p('json'),
  cache_stats: null,
  stats_latency_panel: null,
  otp_limiter_panel: p('limiter'),
  stream_groups: p('stream'),
  ts_chart: p('ts'),
  bf_card: p('bf'),
  ft_card: p('idx'),
  acl_users: null,
} as const satisfies Record<string, string | null>;

/** Every key the setup may create (the search index is not a key; its documents are). */
export const PRACTICE_DEL: string[] = [
  p('string'),
  p('hash'),
  p('list'),
  p('set'),
  p('board'),
  p('ttl'),
  p('streak'),
  p('hll'),
  p('geo'),
  p('stream'),
  p('json'),
  p('limiter'),
  p('ts'),
  p('bf'),
  p('doc:1'),
  p('doc:2'),
  p('doc:3'),
];

/** Setup commands, in order. `now` is injected so tests are deterministic. */
export function setupCommands(now: number = Date.now()): string[][] {
  const minute = 60000;
  const streakDays = [0, 1, 2, 4, 5, 6, 7, 8, 9, 10];
  return [
    ['SET', p('string'), 'hello from the nets'],
    ['HSET', p('hash'), 'name', 'Asha', 'role', 'opening batter', 'runs', '45'],
    ['LPUSH', p('list'), 'Over 18 begins', 'Wicket: Lightning Rod', 'Anna Express hits a six'],
    ['SADD', p('set'), 'p-028', 'p-101', 'p-151'],
    [
      'ZADD',
      p('board'),
      '140',
      'user:teja',
      '120',
      'user:asha',
      '75',
      'user:ravi',
      '40',
      'user:meena',
    ],
    ['SET', p('ttl'), 'welcome gift', 'EX', '90'],
    ...streakDays.map((d) => ['SETBIT', p('streak'), String(d), '1']),
    ['PFADD', p('hll'), ...Array.from({ length: 24 }, (_, i) => `visitor-${i + 1}`)],
    [
      'GEOADD',
      p('geo'),
      '73.86',
      '18.52',
      'Shivneri Hostel',
      '73.9',
      '18.56',
      'Canteen Lawn',
      '73.82',
      '18.5',
      'Library Steps',
    ],
    ['XADD', p('stream'), '*', 'over', '17.3', 'runs', '1'],
    ['XADD', p('stream'), '*', 'over', '17.4', 'runs', '6'],
    ['XADD', p('stream'), '*', 'over', '17.5', 'runs', '0'],
    ['XGROUP', 'CREATE', p('stream'), 'scorer', '0'],
    ['XREADGROUP', 'GROUP', 'scorer', 'w1', 'COUNT', '2', 'STREAMS', p('stream'), '>'],
    [
      'JSON.SET',
      p('json'),
      '$',
      JSON.stringify({
        name: 'Ganapathi Chengappa',
        team: 'CLH',
        stats: { runs: 512, strikeRate: 171.4 },
        tags: ['batter', 'fame-99'],
      }),
    ],
    ['HSET', p('limiter'), 'tokens', '3', 'ts', String(now)],
    ['TS.CREATE', p('ts'), 'RETENTION', '3600000', 'LABELS', 'source', 'practice'],
    ...[12, 15, 14, 22, 31, 28, 35, 33].map((v, i, a) => [
      'TS.ADD',
      p('ts'),
      String(now - (a.length - i) * minute),
      String(v),
    ]),
    ['BF.RESERVE', p('bf'), '0.01', '1000'],
    ['BF.MADD', p('bf'), 'asha', 'teja', 'ravi', 'meena'],
    ['HSET', p('doc:1'), 'title', 'Opening over', 'fee', '49'],
    ['HSET', p('doc:2'), 'title', 'Death overs', 'fee', '99'],
    ['HSET', p('doc:3'), 'title', 'Powerplay', 'fee', '29'],
    [
      'FT.CREATE',
      p('idx'),
      'ON',
      'HASH',
      'PREFIX',
      '1',
      p('doc:'),
      'SCHEMA',
      'title',
      'TEXT',
      'fee',
      'NUMERIC',
    ],
  ];
}

/** Clean-up commands: one DEL for the keys, and the search index dropped (its error when absent is harmless). */
export function cleanupCommands(): string[][] {
  return [
    ['DEL', ...PRACTICE_DEL],
    ['FT.DROPINDEX', p('idx')],
  ];
}

/** One EXISTS over every key tells the gallery whether the nets are set up. */
export const PRACTICE_EXISTS: string[] = ['EXISTS', ...PRACTICE_DEL];
