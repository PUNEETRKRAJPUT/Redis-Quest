import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test } from 'vitest';
import {
  completionContext,
  completionsAt,
  MULTI_CHAIN,
  namespaceNames,
  suggestionsFor,
} from '../src/editor/completion';
import type { ClientApi } from '../src/editor/completion';

const here = path.dirname(fileURLToPath(import.meta.url));
// The committed output of scripts/dev/gen-client-api.mjs: the real list, not a fixture written here.
const api = JSON.parse(
  readFileSync(path.join(here, '../src/editor/client-api.generated.json'), 'utf8'),
) as ClientApi;
const NS = namespaceNames(api);
const ctx = (s: string) => completionContext(s, NS);
const names = (s: string) => completionsAt(api, s).map((x) => x.label);

test('the generated list records the library it came from, and holds the commands learners use', () => {
  expect(api.source.library).toBe('redis');
  expect(api.source.version).toMatch(/^\d+\.\d+\.\d+/);
  const has = (n: string) => api.redis.some((m) => m.name === n && m.kind === 'method');
  for (const n of [
    'get',
    'set',
    'hSet',
    'lPush',
    'zIncrBy',
    'xAdd',
    'multi',
    'expire',
    'sendCommand',
  ])
    expect(has(n)).toBe(true);
  expect(NS).toEqual(expect.arrayContaining(['json', 'ft', 'ts', 'bf']));
  // each command once, in its camelCase spelling
  expect(api.redis.some((m) => m.name === 'SET')).toBe(false);
  expect(api.multi.only.map((m) => m.name)).toContain('exec');
  expect(api.db.map((m) => m.name)).toEqual(['query']);
});

test('a dot after redis, deps.redis and redisCached completes the client', () => {
  for (const before of [
    'redis.',
    'await redis.',
    'const x = deps.redis.',
    'redisCached.',
    'redis.se',
  ]) {
    expect(ctx(before)?.target).toEqual({ kind: 'redis' });
  }
  expect(ctx('redis.se')?.prefix).toBe('se');
  expect(names('redis.')).toEqual(expect.arrayContaining(['get', 'set', 'hSet', 'multi', 'json']));
});

test('redis.multi() and every call chained on it complete the chain', () => {
  for (const before of [
    'redis.multi().',
    'redis.multi()\n  .set("a", "1")\n  .',
    "redis.multi().set('a', 'x (y)').get('a').",
    'await redis\n  .multi()\n  .incr("n")\n  .',
    'redis.MULTI().',
  ]) {
    expect(ctx(before)?.target).toEqual({ kind: 'multi' });
  }
  const chain = completionsAt(api, 'redis.multi().');
  expect(chain.map((s) => s.label)).toEqual(expect.arrayContaining(['set', 'get', 'exec']));
  // a command on the chain returns the chain, not a promise
  expect(chain.find((s) => s.label === 'set')?.description).toBe(MULTI_CHAIN);
  expect(chain.find((s) => s.label === 'exec')?.description).toContain('Promise');
  // the client's own lifecycle is not on the chain
  expect(chain.map((s) => s.label)).not.toContain('connect');
  expect(chain.map((s) => s.label)).not.toContain('multi');
});

test('after exec() or an ordinary command the type is no longer known, so nothing is offered', () => {
  expect(ctx('redis.multi().set("a", 1).exec().')).toBeNull();
  expect(ctx('redis.get("a").')).toBeNull();
  expect(ctx('redis.set("a", 1).then(() => 1).')).toBeNull();
});

test('modules follow the dot: redis.json. and redis.multi().json.', () => {
  expect(ctx('redis.json.')?.target).toEqual({ kind: 'namespace', name: 'json', inMulti: false });
  expect(ctx('redis.multi().ts.')?.target).toEqual({
    kind: 'namespace',
    name: 'ts',
    inMulti: true,
  });
  expect(names('redis.json.')).toEqual(expect.arrayContaining(['set', 'get', 'numIncrBy']));
  expect(names('redis.ts.')).toContain('add');
  expect(names('redis.bf.')).toEqual(expect.arrayContaining(['add', 'exists']));
  const inMulti = completionsAt(api, 'redis.multi().json.');
  expect(inMulti.find((s) => s.label === 'set')?.description).toBe(MULTI_CHAIN);
});

test('db. and log. offer their own members', () => {
  expect(ctx('db.')?.target).toEqual({ kind: 'db' });
  expect(names('const r = await db.')).toEqual(['query']);
  const q = completionsAt(api, 'db.')[0];
  expect(q?.detail).toContain('text: string');
  expect(q?.insertText).toBe('query($0)');
  expect(ctx('log.')?.target).toEqual({ kind: 'log' });
  expect(names('log.')).toEqual(expect.arrayContaining(['call', 'apply', 'bind']));
});

test('only the learner names count, and only at a dot', () => {
  for (const before of [
    'redis',
    'redis ',
    'redis.set(',
    "redis.set('a', ",
    'my.redis.',
    'myredis.',
    'redisX.',
    'dbx.',
    '// redis.\nconst a = 1;',
    'const s = "redis.',
    '  // then ask redis.',
    '/* the client: redis.',
    'other.',
    '1.',
    '',
  ]) {
    expect(ctx(before)).toBeNull();
  }
});

test('a dot inside a string or a comment is not a member access, but a closed string or comment is', () => {
  expect(ctx('const s = "a b"; redis.')?.target).toEqual({ kind: 'redis' });
  expect(ctx("log('it\\'s fine'); redis.")?.target).toEqual({ kind: 'redis' });
  expect(ctx('/* note */ redis.')?.target).toEqual({ kind: 'redis' });
  expect(ctx('// note\nredis.')?.target).toEqual({ kind: 'redis' });
});

test('the nearest name wins when calls nest', () => {
  expect(ctx("redis.set('a', db.")?.target).toEqual({ kind: 'db' });
  expect(ctx("redis.multi().set('a', 1); db.")?.target).toEqual({ kind: 'db' });
  expect(ctx('redis.multi().set("k", log.')?.target).toEqual({ kind: 'log' });
});

test('a method becomes a snippet with the signature as detail; a property stays a name', () => {
  const set = suggestionsFor(api, { kind: 'redis' }).find((s) => s.label === 'set');
  expect(set?.insertText).toBe('set($0)');
  expect(set?.snippet).toBe(true);
  expect(set?.detail).toMatch(/^\(key: RedisArgument/);
  expect(set?.documentation).toContain(`node-redis ${api.source.version}`);
  const open = suggestionsFor(api, { kind: 'redis' }).find((s) => s.label === 'isOpen');
  expect(open?.kind).toBe('property');
  expect(open?.insertText).toBe('isOpen');
  expect(open?.snippet).toBe(false);
  const hset = suggestionsFor(api, { kind: 'redis' }).find((s) => s.label === 'hSet');
  expect(hset?.documentation).toContain('Accepted forms');
});
