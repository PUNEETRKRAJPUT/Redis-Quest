import { expect, test } from 'vitest';
import type { Progress } from '../src/index.js';

test('shared test runner works', () => {
  const p: Progress = { version: 1 };
  expect(p.version).toBe(1);
});
