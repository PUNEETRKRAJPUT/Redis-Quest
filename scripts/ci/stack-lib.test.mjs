// Unit tests for stack-lib.mjs. Run with: node --test scripts/ci/stack-lib.test.mjs
import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  REDIS_DEFAULTS,
  encodeCommand,
  healthIsReady,
  portOf,
  redactUrl,
  routeFor,
} from './stack-lib.mjs';

test('routeFor mirrors docker/Caddyfile', () => {
  assert.equal(routeFor('/app/health'), 'app');
  assert.equal(routeFor('/app/oncall/badges/recompute?x=1'), 'app');
  assert.equal(routeFor('/api'), 'engine');
  assert.equal(routeFor('/api/levels/ch1-01'), 'engine');
  assert.equal(routeFor('/health'), 'engine');
  assert.equal(routeFor('/ws'), 'engine');
  assert.equal(routeFor('/ws?token=1'), 'engine');
  assert.equal(routeFor('/internal/app-config'), 'engine');
  assert.equal(routeFor('/'), null);
  assert.equal(routeFor('/_next/static/x.js'), null);
  assert.equal(routeFor('/apple'), null);
  assert.equal(routeFor('/application/x'), null);
  assert.equal(routeFor('/healthz'), null);
});

test('redactUrl hides a password and survives garbage', () => {
  assert.equal(
    redactUrl('postgres://quest:quest@localhost:5432/quest'),
    'postgres://quest:***@localhost:5432/quest',
  );
  assert.equal(redactUrl('redis://localhost:6379'), 'redis://localhost:6379');
  assert.equal(redactUrl('not a url'), '(not a valid URL)');
});

test('portOf falls back when the URL has no port', () => {
  assert.equal(portOf('redis://localhost:6395', 6379), '6395');
  assert.equal(portOf('redis://localhost', 6379), '6379');
  assert.equal(portOf('???', 5432), '5432');
});

test('encodeCommand writes a RESP array of bulk strings', () => {
  assert.equal(encodeCommand(['PING']), '*1\r\n$4\r\nPING\r\n');
  assert.equal(
    encodeCommand(['CONFIG', 'SET', 'save', '60 1000']),
    '*4\r\n$6\r\nCONFIG\r\n$3\r\nSET\r\n$4\r\nsave\r\n$7\r\n60 1000\r\n',
  );
  assert.equal(encodeCommand(['SET', 'k', 'é']), '*3\r\n$3\r\nSET\r\n$1\r\nk\r\n$2\r\né\r\n');
});

test('REDIS_DEFAULTS are all CONFIG SET commands', () => {
  for (const c of REDIS_DEFAULTS) assert.deepEqual(c.slice(0, 2), ['CONFIG', 'SET']);
});

test('healthIsReady wants redis, postgres and levels all fine', () => {
  const ok = { ok: true, redis: 'up', postgres: 'up', levels: 'ok' };
  assert.equal(healthIsReady(ok), true);
  assert.equal(healthIsReady(JSON.stringify(ok)), true);
  assert.equal(healthIsReady({ ...ok, postgres: 'down' }), false);
  assert.equal(healthIsReady({ ...ok, levels: 'error' }), false);
  assert.equal(healthIsReady('not json'), false);
});
