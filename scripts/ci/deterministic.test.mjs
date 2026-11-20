// Unit tests for deterministic.mjs. Run with: node --test scripts/ci/deterministic.test.mjs
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { deterministicSkipReason } from './deterministic.mjs';

const quiz = { type: 'quiz' };

test('plain cli, code and decision levels are graded', () => {
  assert.equal(deterministicSkipReason({ mode: 'cli', verify: [{ type: 'redis' }] }), null);
  assert.equal(
    deterministicSkipReason({
      mode: 'code',
      verify: [{ type: 'behavior' }, { type: 'antipattern' }],
    }),
    null,
  );
  assert.equal(deterministicSkipReason({ mode: 'decision', verify: [quiz] }), null);
});

test('ops levels are skipped', () => {
  assert.match(deterministicSkipReason({ mode: 'ops', verify: [] }) ?? '', /^mode ops/);
});

test('outage and profile events are skipped', () => {
  for (const kind of ['redis_disconnect', 'redis_reconnect']) {
    assert.match(
      deterministicSkipReason({ mode: 'cli', verify: [{ type: 'event', kind }] }) ?? '',
      /outage/,
    );
  }
  for (const name of ['redis_target_changed', 'sentinel_failover']) {
    assert.match(
      deterministicSkipReason({
        mode: 'cli',
        verify: [{ type: 'event', kind: 'custom', match: { name } }],
      }) ?? '',
      /profiles/,
    );
  }
});

test('events that do not depend on the machine stay graded', () => {
  const ev = (kind, match) => ({ mode: 'cli', verify: [{ type: 'event', kind, match }] });
  assert.equal(deterministicSkipReason(ev('key_expired', { key: 'k' })), null);
  assert.equal(deterministicSkipReason(ev('channel_message', { channel: 'c' })), null);
  assert.equal(deterministicSkipReason(ev('custom', { name: 'ticker_gap' })), null);
});

test('a load run is skipped', () => {
  const r = deterministicSkipReason({
    mode: 'code',
    verify: [{ type: 'event', kind: 'custom', match: { name: 'load_finished' } }],
  });
  assert.match(r ?? '', /load run/);
});

test('traffic checks are skipped, with the reason that fits', () => {
  const traffic = (baseline, assertions) => ({
    mode: 'code',
    verify: [{ type: 'behavior' }, { type: 'traffic', baseline, assertions }],
  });
  assert.match(
    deterministicSkipReason(traffic(true, { db_calls_ratio_lte: 0.1 })) ?? '',
    /baseline/,
  );
  assert.match(deterministicSkipReason(traffic(false, { p99_ms_lte: 50 })) ?? '', /latency/);
  assert.match(
    deterministicSkipReason(traffic(false, { rps_ratio_gte: 1 })) ?? '',
    /latency or throughput/,
  );
  assert.match(
    deterministicSkipReason(traffic(false, { db_queries_lte: 10 })) ?? '',
    /how much load/,
  );
});

test('a pool interview level is skipped', () => {
  const r = deterministicSkipReason({ mode: 'code', verify: [], interview: { pool: [{}] } });
  assert.match(r ?? '', /random/);
});
