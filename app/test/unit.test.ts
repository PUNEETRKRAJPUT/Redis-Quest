import { describe, expect, test } from 'vitest';
import { parseAppConfig } from '../src/engine.js';
import { headerSafe } from '../src/errors.js';
import { MetricsRecorder } from '../src/metrics.js';
import { SLOTS } from '../src/slots/registry.js';
import { validateRegistry } from '../src/slots/validate.js';

describe('slot registry', () => {
  test('the shipped registry is valid', () => {
    expect(validateRegistry(SLOTS)).toEqual([]);
  });

  test('declares the Milestone 1 slots', () => {
    expect(SLOTS.map((s) => s.name).sort()).toEqual([
      'cache.getPlayerStats',
      'cache.invalidatePlayerStats',
      'leaderboard.top',
      'onboarding.registerUser',
      'prefetch.getFixtures',
      'ratelimit.allow',
      'session.create',
      'session.get',
    ]);
    expect(SLOTS.find((s) => s.name === 'cache.getPlayerStats')).toMatchObject({
      file: 'ch2/cache.js',
      signature: '(deps, playerId)',
    });
    expect(SLOTS.find((s) => s.name === 'onboarding.registerUser')?.signature).toBe('(deps, user)');
  });

  test('catches author mistakes', () => {
    const baseline = async () => null;
    const problems = validateRegistry([
      { name: 'Cache.get', file: 'ch2/a.js', signature: '(deps)', returns: '', baseline },
      { name: 'cache.a', file: '../x.js', signature: '(deps)', returns: '', baseline },
      { name: 'cache.b', file: 'ch2/b.js', signature: '(deps)', returns: '', baseline },
      { name: 'cache.b', file: 'ch2/b.js', signature: 'deps', returns: '', baseline },
    ]);
    expect(problems.join('\n')).toMatch(/Cache\.get: name/);
    expect(problems.join('\n')).toMatch(/cache\.a: file must be a plain relative path/);
    expect(problems.join('\n')).toMatch(/cache\.b: declared twice/);
    expect(problems.join('\n')).toMatch(/already used by another slot/);
    expect(problems.join('\n')).toMatch(/signature must look like/);
  });
});

describe('metrics recorder', () => {
  test('drains one window per route with the pushed shape', () => {
    const r = new MetricsRecorder();
    for (let i = 1; i <= 100; i++)
      r.record('GET /app/x', {
        ms: i,
        status: 200,
        dbQueries: i % 2,
        redisCommands: 2,
        slotError: false,
      });
    r.record('GET /app/x', {
      ms: 500,
      status: 500,
      dbQueries: 0,
      redisCommands: 1,
      slotError: true,
    });
    const w = r.drain();
    expect(w['GET /app/x']).toEqual({
      count: 101,
      errors: 1,
      p50Ms: 51,
      p99Ms: 100,
      dbQueries: 50,
      redisCommands: 201,
      noDbCount: 51,
      slotErrors: 1,
    });
    expect(r.drain()).toEqual({});
  });
});

describe('app config parsing', () => {
  test('accepts the engine shape and rejects junk', () => {
    expect(
      parseAppConfig({
        target: { redisUrl: 'redis://redis:6379' },
        activeSlots: ['a.b'],
        dbExtraLatencyMs: 0,
        etag: 'x',
      }),
    ).toEqual({
      target: { redisUrl: 'redis://redis:6379' },
      activeSlots: ['a.b'],
      dbExtraLatencyMs: 0,
    });
    expect(() => parseAppConfig({ target: { redisUrl: 'http://x' }, activeSlots: [] })).toThrow(
      /redisUrl/,
    );
    expect(() => parseAppConfig({ target: { redisUrl: 'redis://x' }, activeSlots: 'a' })).toThrow(
      /activeSlots/,
    );
  });
});

test('header values from learner messages are made safe', () => {
  expect(headerSafe('boom\nline twoé')).toBe('boom line two?');
  expect(headerSafe('x'.repeat(400)).length).toBe(300);
});
