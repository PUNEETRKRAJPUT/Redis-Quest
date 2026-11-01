import { renderToStaticMarkup } from 'react-dom/server';
import { expect, test } from 'vitest';
import { buildImpact, metricPhrases } from '../src/impact';
import { parseReply } from '../src/redisReply';
import { ImpactLog } from '../src/screens/ImpactLog';
import { SHOW_ME_IDS } from '../src/showme';
import {
  isMissingError,
  parseAclList,
  parseBfInfo,
  parseFtIds,
  parseFtInfo,
  parsePendingByConsumer,
  parseStreamGroups,
  parseTsInfo,
  parseTsRange,
} from '../src/showme/parse';
import { SAMPLE } from '../src/showme/sample';
import {
  AclUsersView,
  BfCardView,
  FtCardView,
  fmtRetention,
  StreamGroupsView,
  TsChartView,
} from '../src/showme/views';
import type { ChapterSummary, Progress } from '../src/types';

const s = SAMPLE;

// ---- replies as the terminal prints them (RESP2 through redis-cli formatting) ----------------------------
const XINFO_GROUPS = `1)  1) "name"
    2) "scorer"
    3) "consumers"
    4) (integer) 2
    5) "pending"
    6) (integer) 3
    7) "last-delivered-id"
    8) "1730000002000-0"
    9) "entries-read"
   10) (integer) 1840
   11) "lag"
   12) (integer) 0
2)  1) "name"
    2) "analytics"
    3) "consumers"
    4) (integer) 0
    5) "pending"
    6) (integer) 0
    7) "last-delivered-id"
    8) "0-0"
    9) "entries-read"
   10) (nil)
   11) "lag"
   12) (nil)`;

const XPENDING = `1) (integer) 3
2) "1730000001000-0"
3) "1730000002000-0"
4) 1) 1) "w1"
      2) "2"
   2) 1) "w2"
      2) "1"`;

test('the five new ids are registered', () => {
  for (const id of ['stream_groups', 'ts_chart', 'bf_card', 'ft_card', 'acl_users'])
    expect(SHOW_ME_IDS as readonly string[]).toContain(id);
});

test('XINFO GROUPS and XPENDING parse from redis-cli text; a nil lag is unknown', () => {
  const g = parseStreamGroups(parseReply(XINFO_GROUPS));
  expect(g).toEqual([
    { name: 'scorer', consumers: 2, pending: 3, lag: 0, lastDeliveredId: '1730000002000-0' },
    { name: 'analytics', consumers: 0, pending: 0, lag: null, lastDeliveredId: '0-0' },
  ]);
  expect(parsePendingByConsumer(parseReply(XPENDING))).toEqual([
    { consumer: 'w1', pending: 2 },
    { consumer: 'w2', pending: 1 },
  ]);
  expect(
    parsePendingByConsumer(parseReply('1) (integer) 0\n2) (nil)\n3) (nil)\n4) (nil)')),
  ).toEqual([]);
  expect(parseStreamGroups(parseReply('(empty array)'))).toEqual([]);
});

test('stream_groups view: rows, per-consumer pending, and the empty states', () => {
  const html = renderToStaticMarkup(<StreamGroupsView {...s.groups} />);
  expect(html).toContain('data-showme="stream_groups"');
  expect(html).toContain('data-group="scorer"');
  expect(html).toContain('w1: 2, w2: 1');
  expect(html).toContain('412');
  expect(html).toContain('1730000002000-0');
  expect(renderToStaticMarkup(<StreamGroupsView name="k" length={null} groups={[]} />)).toContain(
    'no stream yet',
  );
  expect(renderToStaticMarkup(<StreamGroupsView name="k" length={0} groups={[]} />)).toContain(
    'no stream yet',
  );
  const noGroups = renderToStaticMarkup(<StreamGroupsView name="k" length={12} groups={[]} />);
  expect(noGroups).toContain('No consumer group yet');
  expect(noGroups).not.toContain('no stream yet');
  const unknownLag = renderToStaticMarkup(
    <StreamGroupsView
      name="k"
      length={5}
      groups={[
        { name: 'g', consumers: 0, pending: 0, lag: null, lastDeliveredId: '0-0', perConsumer: [] },
      ]}
    />,
  );
  expect(unknownLag).toContain('unknown');
});

test('TS.INFO and TS.RANGE parse; only the last 60 buckets are kept', () => {
  const info = parseTsInfo(
    parseReply(`1) "totalSamples"
2) (integer) 482
3) "memoryUsage"
4) (integer) 4184
5) "retentionTime"
6) (integer) 3600000
7) "labels"
8) 1) 1) "route"
      2) "stats"
9) "sourceKey"
10) (nil)`),
  );
  expect(info).toEqual({ retentionMs: 3600000, totalSamples: 482, labels: [['route', 'stats']] });
  // The engine pads indexes to the width of the largest one (70 rows: two digits) and indents continuation lines.
  const rows = Array.from(
    { length: 70 },
    (_, i) => `${String(i + 1).padStart(2)}) 1) (integer) ${i * 60000}\n    2) "${i}.5"`,
  );
  const range = parseTsRange(parseReply(rows.join('\n')));
  expect(range).toHaveLength(60);
  expect(range[59]).toEqual({ ts: 69 * 60000, value: 69.5 });
  expect(range[0]?.value).toBe(10.5);
  expect(parseTsRange(parseReply('(empty array)'))).toEqual([]);
});

test('ts_chart view: sparkline, last value, labels, retention and the empty states', () => {
  const html = renderToStaticMarkup(<TsChartView {...s.ts} />);
  expect(html).toContain('data-showme="ts_chart"');
  expect(html).toContain('<polyline');
  expect(html).toContain('41'); // the last value is printed
  expect(html).toContain('1 h');
  expect(html).toContain('route=stats');
  expect(html).toContain('482');
  expect(renderToStaticMarkup(<TsChartView name="k" info={null} values={[]} />)).toContain(
    'no samples yet',
  );
  expect(
    renderToStaticMarkup(
      <TsChartView name="k" info={{ retentionMs: 0, totalSamples: 0, labels: [] }} values={[]} />,
    ),
  ).toContain('no samples yet');
  expect(fmtRetention(0)).toBe('forever');
  expect(fmtRetention(86400000)).toBe('1 d');
  expect(fmtRetention(90000)).toBe('90000 ms');
});

test('BF.INFO parses; the bf_card view shows each field and the missing state', () => {
  const info = parseBfInfo(
    parseReply(`1) "Capacity"
2) (integer) 10000
3) "Size"
4) (integer) 18006
5) "Number of filters"
6) (integer) 1
7) "Number of items inserted"
8) (integer) 5000
9) "Expansion rate"
10) (integer) 2`),
  );
  expect(info).toEqual({
    capacity: 10000,
    sizeBytes: 18006,
    filters: 1,
    inserted: 5000,
    expansion: 2,
  });
  const html = renderToStaticMarkup(<BfCardView {...s.bf} />);
  expect(html).toContain('10,000');
  expect(html).toContain('18,006 bytes');
  expect(html).toContain('5,000');
  expect(renderToStaticMarkup(<BfCardView name="k" info={null} card={null} />)).toContain(
    'no filter yet',
  );
  const nonScaling = renderToStaticMarkup(
    <BfCardView name="k" info={{ ...s.bf.info, expansion: null }} card={null} />,
  );
  expect(nonScaling).toContain('none');
  expect(nonScaling).toContain('n/a');
});

test('FT.INFO and FT.SEARCH parse; the ft_card view and the unknown-index state', () => {
  const info = parseFtInfo(
    parseReply(`1) "index_name"
2) "idx:contest"
3) "index_definition"
4) 1) "key_type"
   2) "JSON"
   3) "prefixes"
   4) 1) "contest:"
   5) "default_score"
   6) "1"
5) "attributes"
6) 1) 1) "identifier"
      2) "$.name"
      3) "attribute"
      4) "name"
      5) "type"
      6) "TEXT"
   2) 1) "identifier"
      2) "$.fee"
      3) "attribute"
      4) "fee"
      5) "type"
      6) "NUMERIC"
7) "num_docs"
8) "200"`),
  );
  expect(info).toEqual({
    numDocs: 200,
    prefixes: ['contest:'],
    fields: [
      { name: 'name', type: 'TEXT' },
      { name: 'fee', type: 'NUMERIC' },
    ],
  });
  expect(
    parseFtIds(
      parseReply('1) (integer) 200\n2) "contest:9101"\n3) "contest:9102"\n4) "contest:9103"'),
    ),
  ).toEqual(['contest:9101', 'contest:9102', 'contest:9103']);
  expect(parseFtIds(parseReply('1) (integer) 0'))).toEqual([]);
  const html = renderToStaticMarkup(<FtCardView {...s.ft} />);
  expect(html).toContain('contest:9102');
  expect(html).toContain('NUMERIC');
  expect(html).toContain('>200<');
  expect(renderToStaticMarkup(<FtCardView name="k" info={null} docIds={[]} />)).toContain(
    'no index yet',
  );
  expect(
    renderToStaticMarkup(
      <FtCardView name="k" info={{ numDocs: 0, prefixes: [], fields: [] }} docIds={[]} />,
    ),
  ).toContain('No documents indexed yet');
  expect(isMissingError('Unknown index name')).toBe(true);
  expect(isMissingError('ERR no such key')).toBe(true);
  expect(isMissingError('ERR not found')).toBe(true);
  expect(isMissingError('WRONGTYPE Operation against a key')).toBe(false);
  expect(isMissingError(null)).toBe(false);
});

test('ACL LIST parses with the default user first; the acl_users view lists each rule string', () => {
  const users = parseAclList(
    parseReply(`1) "user scorer on sanitize-payload #abc resetchannels -@all +xack ~match:*"
2) "user default on nopass sanitize-payload ~* &* +@all"`),
  );
  expect(users.map((u) => u.name)).toEqual(['default', 'scorer']);
  expect(users[1]?.rules).toBe('on sanitize-payload #abc resetchannels -@all +xack ~match:*');
  const html = renderToStaticMarkup(<AclUsersView users={users} />);
  expect(html.indexOf('data-user="default"')).toBeLessThan(html.indexOf('data-user="scorer"'));
  expect(html).toContain('+@all');
  expect(renderToStaticMarkup(<AclUsersView users={[]} />)).toContain('No ACL users');
  expect(renderToStaticMarkup(<AclUsersView {...s.acl} />)).toContain('data-showme="acl_users"');
});

// ---- the impact log -------------------------------------------------------------------------------------
const chapters: ChapterSummary[] = [
  {
    id: 'ch2',
    dirName: 'ch2',
    title: 'Everyone showed up',
    incident: [],
    levels: [
      {
        id: 'ch2-02',
        title: 'Cache aside v1',
        mode: 'code',
        xp: 50,
        status: 'passed',
        attempts: 1,
      },
      {
        id: 'ch2-03',
        title: 'Stale is a bug',
        mode: 'code',
        xp: 50,
        status: 'passed',
        attempts: 2,
      },
      { id: 'ch2-04', title: 'Stampede', mode: 'code', xp: 50, status: 'in_progress', attempts: 1 },
    ],
  },
  {
    id: 'finale',
    dirName: 'finale',
    title: 'The architect',
    incident: [],
    levels: [
      {
        id: 'cf-01',
        title: 'Mock interview one',
        mode: 'code',
        xp: 100,
        status: 'passed',
        attempts: 1,
      },
    ],
  },
];
const progress = {
  version: 1,
  player: { id: 'p-1', name: 'Asha', createdAt: 'x' },
  target: { redisUrl: 'redis://redis:6379' },
  activeSlots: [],
  xp: 1230,
  badges: [],
  levels: {
    'ch2-02': {
      status: 'passed',
      attempts: 2,
      verdicts: [
        { at: 'a', verdict: 'works_but_wrong', metrics: { p99Ms: 9999 } },
        {
          at: 'b',
          verdict: 'right',
          metrics: {
            p99Ms: 11,
            baselineP99Ms: 4100,
            dbPerRequest: 0.02,
            baselineDbPerRequest: 1,
            redisPerRequest: 2,
            hitRatio: 0.987,
            rps: 1520,
          },
        },
      ],
    },
    'ch2-03': { status: 'passed', attempts: 1, verdicts: [{ at: 'c', verdict: 'right' }] },
    'cf-01': {
      status: 'passed',
      attempts: 1,
      verdicts: [{ at: 'd', verdict: 'right', elapsedMs: 723000 }],
      interviewElapsedMs: 723000,
      overtime: true,
    },
    'ch2-04': {
      status: 'in_progress',
      attempts: 1,
      verdicts: [{ at: 'e', verdict: 'right', metrics: { rps: 5 } }],
    },
  },
} as unknown as Progress;

test('the impact log lists passed levels with numbers, in play order, and skips the rest', () => {
  const impact = buildImpact(chapters, progress);
  expect(impact.summary).toBe('2 chapters, 3 of 4 levels passed, 1,230 XP.');
  expect(impact.entries.map((e) => e.levelId)).toEqual(['ch2-02', 'cf-01']);
  const html = renderToStaticMarkup(<ImpactLog impact={impact} />);
  expect(html).toContain('data-testid="impact-log"');
  expect(html).toContain('Cache aside v1');
  expect(html).toContain('Everyone showed up');
  expect(html).toContain('p99 4,100 ms to 11 ms');
  expect(html).toContain('Postgres calls per request 1 to 0.02');
  expect(html).toContain('Redis commands per request 2');
  expect(html).toContain('98.7% of requests made no Postgres call');
  expect(html).toContain('1,520 requests per second');
  expect(html).toContain('rebuilt in 12:03, over the time limit');
  expect(html).not.toContain('9,999'); // the first passing verdict only, not an earlier works_but_wrong
  expect(html).not.toContain('Stale is a bug');
  expect(html).not.toContain('Stampede'); // not passed
});

test('the impact log says so when nothing has numbers yet', () => {
  const html = renderToStaticMarkup(
    <ImpactLog impact={buildImpact(chapters, { ...progress, levels: {}, xp: 0 })} />,
  );
  expect(html).toContain('No numbers yet');
  expect(html).toContain('0 of 4 levels passed, 0 XP.');
  expect(metricPhrases({})).toEqual([]);
  expect(metricPhrases({ p99Ms: 88 })).toEqual(["p99 88 ms under the check's load"]);
});
