// D-06: which commands the game teaches, the board built from the server's own list, the credits' parsers and the
// two routes. Pure data in, no Redis and no level files on disk (the reader is a fake).
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Fastify from 'fastify';
import { afterEach, describe, expect, test } from 'vitest';
import type { LevelFile } from '@quest/shared';
import type { Snapshot } from '../src/command-docs.js';
import { boardNames, buildBoard, skipReason } from '../src/coverage/board.js';
import { parseCast, parseContributors } from '../src/coverage/contributors.js';
import {
  addLevelUsage,
  commandsInChecks,
  commandsInCode,
  commandsInRedisScript,
  commandsInShell,
  methodToCommand,
  type Usage,
} from '../src/coverage/usage.js';
import { createCoverage } from '../src/features/coverage.js';
import type { Reply } from '../src/verify/reply.js';

const KNOWN = new Set([
  'get',
  'set',
  'incr',
  'expire',
  'ttl',
  'hset',
  'hgetall',
  'zadd',
  'zincrby',
  'zrange',
  'xgroup',
  'xreadgroup',
  'xack',
  'xadd',
  'multi',
  'exec',
  'eval',
  'subscribe',
  'publish',
  'keys',
  'scan',
]);

describe('commands in a script', () => {
  test('a .redis script: first word of every command line, comments and blanks skipped, quotes honoured', () => {
    const text = `# comment\n\nINCR canteen:tokens:today\nexpire "canteen:tokens:today" 3600\n  Zadd lb 1 "a b"\n`;
    expect(commandsInRedisScript(text)).toEqual(['incr', 'expire', 'zadd']);
  });

  test('a .sh script: the word after redis-cli and its flags', () => {
    const text = [
      '#!/usr/bin/env bash',
      '# redis-cli GET commented',
      "docker compose exec -T redis redis-cli XADD match:final:balls '*' over 1",
      'docker compose exec -T redis redis-cli -p 6379 -n 1 SET score:final 30',
      'docker compose exec -T redis redis-cli INFO persistence | grep aof',
      'open http://localhost:5540',
    ].join('\n');
    expect(commandsInShell(text)).toEqual(['xadd', 'set', 'info']);
  });
});

describe('commands in a .js solution', () => {
  test('method names map to commands, chains are followed, non-commands are dropped', () => {
    const text = `
      export default async function f({ redis, db }) {
        await redis.connect();
        await redis.zIncrBy('k', 1, 'm');
        await redis.xGroupCreate(key, GROUP, '0-0', { MKSTREAM: true });
        const r = await redis.zRangeWithScores('k', 0, -1);
        await redis.multi().hSet(key, { a: 'x(y)' }).expire(key, 30).exec();
        const rows = await db.query('SELECT 1');
        const cache = new Map(); cache.get('x'); Object.keys({});
        log.info('x');
      }`;
    expect(new Set(commandsInCode(text, KNOWN))).toEqual(
      new Set(['zincrby', 'xgroup', 'zrange', 'multi', 'hset', 'expire', 'exec']),
    );
  });

  test('sendCommand and redis.call inside a Lua string; a duplicated connection is a receiver', () => {
    const text = `
      const LUA = "return redis.call('GET', KEYS[1])";
      await redis.eval(LUA, { keys: ['a'] });
      await redis.sendCommand(['XADD', 'k', '*', 'a', '1']);
      const sub = redis.duplicate();
      await sub.subscribe('ch', () => {});
      other.get('nope');`;
    expect(new Set(commandsInCode(text, KNOWN))).toEqual(
      new Set(['get', 'eval', 'xadd', 'subscribe']),
    );
  });

  test('methodToCommand prefers the exact name, then the longest command that prefixes it', () => {
    expect(methodToCommand('zIncrBy', KNOWN)).toBe('zincrby');
    expect(methodToCommand('xGroupCreateConsumer', KNOWN)).toBe('xgroup');
    expect(methodToCommand('duplicate', KNOWN)).toBeNull();
  });
});

function level(partial: Record<string, unknown>): LevelFile {
  return partial as unknown as LevelFile;
}

describe('commands in checks', () => {
  test('redis, antipattern (both shapes), behavior sideEffect and answer count; quiz and setup do not', () => {
    const verify = [
      { type: 'redis', checks: [{ cmd: ['GET', 'k'] }, { cmd: ['TTL', 'k'] }] },
      { type: 'antipattern', checks: [{ cmd: ['EXISTS', 'k2'] }] },
      {
        type: 'antipattern',
        assertions: [{ sideEffect: [{ cmd: ['SCARD', 's'] }] }, { expect: 1 }],
      },
      { type: 'behavior', assertions: [{ sideEffect: [{ cmd: ['LLEN', 'l'] }] }] },
      { type: 'answer', expected: { cmd: ['HGET', 'h', 'f'] } },
      { type: 'quiz', question: 'q', options: [], correct: [] },
      { type: 'traffic' },
    ];
    expect(commandsInChecks(verify as never)).toEqual([
      'get',
      'ttl',
      'exists',
      'scard',
      'llen',
      'hget',
    ]);
  });
});

describe('addLevelUsage', () => {
  const dir = '/levels/ch9';
  const base = {
    id: 'ch9-01-x',
    verify: [{ type: 'redis', checks: [{ cmd: ['TTL', 'k'] }] }],
  };

  test('records the reference solution and the checks; never the wrong solutions or setup', async () => {
    const usage: Usage = new Map();
    const files: Record<string, string> = {
      '/levels/ch9/solutions/01-reference.redis': 'INCR k\nEXPIRE k 60\n',
      '/levels/ch9/solutions/01-wrong.redis': 'KEYS *\n',
    };
    const read = async (p: string) => {
      const t = files[p];
      if (t === undefined) throw new Error('missing');
      return t;
    };
    const l = level({
      ...base,
      mode: 'cli',
      setup: [{ cmd: ['SADD', 's', '1'] }],
      solutions: {
        reference: 'solutions/01-reference.redis',
        wrong: [{ path: 'solutions/01-wrong.redis', expect: 'wrong', because: 'x' }],
      },
    });
    await addLevelUsage(usage, { dir, level: l }, KNOWN, read);
    expect([...usage.keys()].sort()).toEqual(['expire', 'incr', 'ttl']);
    expect(usage.get('incr')).toEqual([{ levelId: 'ch9-01-x', via: 'solution' }]);
    expect(usage.get('ttl')).toEqual([{ levelId: 'ch9-01-x', via: 'check' }]);
  });

  test('a decision level and a missing solution file give only the checks', async () => {
    const usage: Usage = new Map();
    await addLevelUsage(
      usage,
      {
        dir,
        level: level({ ...base, mode: 'decision', solutions: { reference: ['a'], wrong: [] } }),
      },
      KNOWN,
    );
    await addLevelUsage(
      usage,
      {
        dir,
        level: level({
          ...base,
          mode: 'cli',
          solutions: { reference: 'solutions/nope.redis', wrong: [] },
        }),
      },
      KNOWN,
      async () => {
        throw new Error('missing');
      },
    );
    expect([...usage.keys()]).toEqual(['ttl']);
  });
});

function doc(summary: string, group: string): Reply {
  return ['summary', summary, 'since', '1.0.0', 'group', group, 'complexity', 'O(1)'];
}
function snapshot(entries: [string, string | null, string][]): Snapshot {
  const docs = new Map<string, [Reply, Reply]>();
  for (const [name, group, summary] of entries) {
    if (group !== null && !name.includes('|'))
      docs.set(name.toLowerCase(), [name, doc(summary, group)]);
  }
  return { names: entries.map((e) => e[0]), docs };
}

describe('the board', () => {
  const snap = snapshot([
    ['get', 'string', 'Returns the string value of a key.'],
    ['set', 'string', 'Sets the string value of a key.'],
    ['append', 'string', 'Appends a string to the value of a key.'],
    ['zadd', 'sorted-set', 'Adds members to a sorted set.'],
    ['client|list', 'connection', 'Lists connections.'],
    ['FT.SEARCH', 'search', 'Searches.'],
    ['ts.info', 'timeseries', 'Info.'],
    ['_internal', 'server', 'x'],
    ['vadd', 'module', 'Adds a vector.'],
    ['mystery', null, ''],
  ]);

  test('skipReason follows the terminal scope cuts', () => {
    expect(skipReason('client|list', 'connection')).toBe('subcommand');
    expect(skipReason('FT.SEARCH', 'search')).toBe('module');
    expect(skipReason('ts.info', undefined)).toBe('module');
    expect(skipReason('_x', 'server')).toBe('module');
    expect(skipReason('vadd', 'module')).toBe('module');
    expect(skipReason('get', 'string')).toBeNull();
  });

  test('boardNames is the top-level, in-scope set', () => {
    expect([...boardNames(snap)].sort()).toEqual(['append', 'get', 'mystery', 'set', 'zadd']);
  });

  test('groups, taught flags, untaught first, counts add up to the server list', () => {
    const usage: Usage = new Map([
      ['get', [{ levelId: 'ch1-01-a', via: 'solution' as const }]],
      ['zadd', [{ levelId: 'house-01-b', via: 'check' as const }]],
    ]);
    const b = buildBoard(snap, usage);
    expect(b.listed).toBe(10);
    expect(b.commands + b.skipped.subcommands + b.skipped.modules).toBe(b.listed);
    expect(b.skipped).toEqual({ subcommands: 1, modules: 4 });
    expect(b).toMatchObject({ commands: 5, taught: 2, untaught: 3 });
    const string = b.groups.find((g) => g.group === 'string');
    expect(string?.commands.map((c) => [c.name, c.taught])).toEqual([
      ['append', false],
      ['set', false],
      ['get', true],
    ]);
    expect(string?.commands[0]?.summary).toBe('Appends a string to the value of a key.');
    expect(b.groups.map((g) => g.group)).toEqual(['string', 'undocumented', 'sorted-set']);
    expect(b.groups.find((g) => g.group === 'undocumented')?.commands[0]?.name).toBe('mystery');
  });
});

describe('contributors and cast', () => {
  test('parseContributors reads list lines only', () => {
    const md = [
      '# Contributors',
      'Intro text - not an entry',
      '    - Example Name (@example): indented example',
      '<!-- ',
      '- Hidden (@hidden): in a comment',
      '-->',
      '- Asha Rao (@asha-r): wrote the canteen level',
      '- Dev Patel: no github',
      '* Mei (@mei)',
      '- (@nobody)',
    ].join('\n');
    expect(parseContributors(md)).toEqual([
      { name: 'Asha Rao', github: 'asha-r', note: 'wrote the canteen level' },
      { name: 'Dev Patel', github: null, note: 'no github' },
      { name: 'Mei', github: 'mei', note: '' },
    ]);
  });

  test('parseCast keeps named entries', () => {
    expect(
      parseCast({
        cast: [{ slug: 'roommate', name: 'Teja', nickname: 'T', role: 'r' }, { slug: 'x' }],
      }),
    ).toEqual([{ slug: 'roommate', name: 'Teja', nickname: 'T', role: 'r' }]);
    expect(parseCast(null)).toEqual([]);
  });
});

describe('routes', () => {
  const dirs: string[] = [];
  afterEach(async () => {
    while (dirs.length) await rm(dirs.pop() as string, { recursive: true, force: true });
  });

  async function app(rootDir: string, commandDocs?: { snapshot(): Snapshot | null }) {
    const f = Fastify();
    const feature = createCoverage({ rootDir });
    await f.register(
      async (api) => {
        await feature.register({
          api,
          deps: {
            commandDocs,
            levels: { chapters: [] },
            cfg: { levelsDir: join(rootDir, 'levels') },
          } as never,
        });
      },
      { prefix: '/api' },
    );
    return f;
  }

  test('coverage says so plainly when there is no snapshot', async () => {
    const f = await app('/nowhere');
    const res = await f.inject({ url: '/api/coverage' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ available: false });
    expect(res.json().reason).toMatch(/no command list/);
    await f.close();
  });

  test('coverage with a snapshot and no levels: everything untaught', async () => {
    const root = await mkdtemp(join(tmpdir(), 'cov-'));
    dirs.push(root);
    const f = await app(root, { snapshot: () => snapshot([['get', 'string', 'Gets.']]) });
    const body = (await f.inject({ url: '/api/coverage' })).json();
    expect(body).toMatchObject({
      available: true,
      commands: 1,
      taught: 0,
      untaught: 1,
      levelsRead: 0,
    });
    await f.close();
  });

  test('credits: files present, files missing', async () => {
    const root = await mkdtemp(join(tmpdir(), 'cov-'));
    dirs.push(root);
    const empty = await app(root);
    expect((await empty.inject({ url: '/api/credits' })).json()).toEqual({
      cast: null,
      contributors: null,
    });
    await empty.close();

    await mkdir(join(root, 'fiction'));
    await writeFile(
      join(root, 'fiction', 'cast.json'),
      JSON.stringify({ cast: [{ name: 'Teja', role: 'r' }] }),
    );
    await writeFile(join(root, 'CONTRIBUTORS.md'), '- Asha (@asha): x\n');
    const f = await app(root);
    expect((await f.inject({ url: '/api/credits' })).json()).toEqual({
      cast: [{ slug: 'Teja', name: 'Teja', nickname: null, role: 'r' }],
      contributors: [{ name: 'Asha', github: 'asha', note: 'x' }],
    });
    await f.close();
  });
});
