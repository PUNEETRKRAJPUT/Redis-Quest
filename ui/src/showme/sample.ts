// Fixed sample data for the #/showme gallery (screenshots and a quick look at every component).
export const SAMPLE = {
  kv: { name: 'otp:p-1a2b3c4d', type: 'string', value: '483921', ttl: 87 },
  hash: {
    name: 'game:player:p-1a2b3c4d',
    fields: [
      ['name', 'Asha'],
      ['xp', '45'],
      ['levels_passed', '3'],
    ] as [string, string][],
    ttl: -1,
  },
  list: {
    name: 'feed:p-1a2b3c4d',
    items: ['Anna Express hits a six', 'Wicket: Lightning Rod', 'Over 18 begins'],
    total: 3,
  },
  set: { name: 'fav:p-1a2b3c4d', members: ['p-028', 'p-101', 'p-151'], highlight: 'p-101' },
  board: {
    name: 'lb:hostel:h-c-02-2',
    rows: [
      { member: 'user:teja', score: 140 },
      { member: 'user:p-1a2b3c4d', score: 120 },
      { member: 'user:ravi', score: 75 },
    ],
    highlight: 'user:p-1a2b3c4d',
  },
  ttl: { name: 'game:welcome:gift', ttl: 86400, total: 86400 },
  streak: { name: 'login:p-1a2b3c4d:2026-11', bits: [1, 1, 0, 1, 1, 1, 1, 1] },
  hll: { name: 'hll:match:m-041', count: 12873 },
  geo: {
    name: 'watchparty:m-041',
    points: [
      { member: 'Shivneri Hostel', lon: 73.86, lat: 18.52 },
      { member: 'Canteen Lawn', lon: 73.9, lat: 18.56 },
      { member: 'Library Steps', lon: 73.82, lat: 18.5 },
    ],
  },
  stream: {
    name: 'match:m-041:balls',
    entries: [
      {
        id: '1730000002000-0',
        fields: [
          ['over', '17.4'],
          ['runs', '6'],
        ] as [string, string][],
      },
      {
        id: '1730000001000-0',
        fields: [
          ['over', '17.3'],
          ['runs', '1'],
        ] as [string, string][],
      },
    ],
  },
  json: {
    name: 'player:p-028',
    value: {
      name: 'Ganapathi Chengappa',
      team: 'CLH',
      stats: { runs: 512, strikeRate: 171.4 },
      tags: ['batter', 'fame-99'],
    },
  },
  cache: { hits: 940, misses: 60, keys: 128, commands: 5120 },
  stats: {
    route: 'GET /app/players/:id/stats',
    p50: 182,
    p99: 640,
    rps: 38,
    dbQps: 38,
    p99Series: [410, 520, 480, 610, 590, 640, 630, 640],
    keys: [{ name: 'cache:player:p-028', exists: false }],
  },
  limiter: {
    name: 'ratelimit:u-limit-1',
    type: 'hash',
    fields: [
      ['tokens', '3'],
      ['ts', '1730000002000'],
    ] as [string, string][],
    value: null,
    ttl: 42,
    members: null,
    pingRequests: 126,
  },
  groups: {
    name: 'match:m-041:balls',
    length: 1840,
    groups: [
      {
        name: 'scorer',
        consumers: 2,
        pending: 3,
        lag: 0,
        lastDeliveredId: '1730000002000-0',
        perConsumer: [
          { consumer: 'w1', pending: 2 },
          { consumer: 'w2', pending: 1 },
        ],
      },
      {
        name: 'analytics',
        consumers: 1,
        pending: 0,
        lag: 412,
        lastDeliveredId: '1730000001000-0',
        perConsumer: [],
      },
    ],
  },
  ts: {
    name: 'ts:requests:GET_app_players_:id_stats',
    info: {
      retentionMs: 3600000,
      totalSamples: 482,
      labels: [['route', 'stats']] as [string, string][],
    },
    values: [12, 15, 14, 22, 31, 28, 35, 33, 40, 38, 36, 41],
  },
  bf: {
    name: 'bf:usernames',
    info: { capacity: 10000, sizeBytes: 18006, filters: 1, inserted: 5000, expansion: 2 },
    card: 5000,
  },
  ft: {
    name: 'idx:contest',
    info: {
      numDocs: 200,
      prefixes: ['contest:'],
      fields: [
        { name: 'name', type: 'TEXT' },
        { name: 'entry_fee', type: 'NUMERIC' },
        { name: 'status', type: 'TAG' },
      ],
    },
    docIds: ['contest:9101', 'contest:9102', 'contest:9103'],
  },
  acl: {
    users: [
      { name: 'default', rules: 'on nopass sanitize-payload ~* &* +@all' },
      {
        name: 'scorer',
        rules: 'on sanitize-payload #<hash> resetchannels -@all +xreadgroup +xack ~match:*',
      },
    ],
  },
};
