// Unit tests for verdict-summary.mjs. Run with: node --test scripts/ci/verdict-summary.test.mjs
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { renderSummary } from './verdict-summary.mjs';

const row = (over) => ({
  level: 'ch1-01-a',
  chapter: 'ch1',
  mode: 'cli',
  solution: 'solutions/01-reference.redis',
  declared: 'right',
  engine: 'right',
  result: 'PASS',
  because: '',
  note: '',
  feedback: [],
  ...over,
});

test('a clean run says no mismatch and counts skips', () => {
  const md = renderSummary({
    rows: [
      row({}),
      row({
        level: 'ch2-01-b',
        chapter: 'ch2',
        result: 'SKIPPED',
        engine: '-',
        note: 'SKIPPED (deterministic mode: needs a real Redis outage; graded by hand)',
      }),
    ],
  });
  assert.match(md, /\*\*No mismatch\.\*\* 1 solutions graded and matching, 1 skipped\./);
  assert.match(md, /needs a real Redis outage/);
  assert.doesNotMatch(md, /### Mismatches/);
});

test('a mismatch is listed with its failing checks, and pipes are escaped', () => {
  const md = renderSummary({
    rows: [
      row({
        result: 'MISMATCH',
        engine: 'wrong',
        because: 'a | b',
        feedback: [
          { index: 0, type: 'redis', tag: 'ok', message: 'fine' },
          { index: 1, type: 'redis', tag: 'fail', message: 'expected 3\nsaw 2' },
        ],
      }),
    ],
  });
  assert.match(md, /\*\*1 MISMATCH\.\*\*/);
  assert.match(md, /### Mismatches/);
  assert.match(md, /declared because: a \\\| b/);
  assert.match(md, /\[fail\] check #1 \(redis\): expected 3 saw 2/);
  assert.doesNotMatch(md, /fine/);
});
