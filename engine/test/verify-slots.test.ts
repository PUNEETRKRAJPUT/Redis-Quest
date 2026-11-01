import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test } from 'vitest';
import { SLOT_FILES } from '../src/verify/slots.js';

// The engine keeps a copy of the app's slot -> file table (it cannot import the app package).
test('slot files match app/src/slots/registry.ts', () => {
  const file = join(dirname(fileURLToPath(import.meta.url)), '../../app/src/slots/registry.ts');
  const src = readFileSync(file, 'utf8');
  const pairs = [...src.matchAll(/name:\s*'([^']+)',\s*file:\s*'([^']+)'/g)].map((m) => [m[1], m[2]]);
  expect(pairs.length).toBeGreaterThan(0);
  expect(Object.fromEntries(pairs)).toEqual(SLOT_FILES);
});
