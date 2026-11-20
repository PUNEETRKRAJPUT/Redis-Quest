#!/usr/bin/env node
// Prints the numbers the launch posts and the README quote, counted from the files. Read-only.
//
//   pnpm --filter @quest/shared build && node scripts/launch/facts.mjs
//
// Compare the output with the posts in docs/launch/posts/ before anything is published. If a number differs,
// change the post, not the number.

import { existsSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const entry = join(ROOT, 'packages/shared/dist/index.js');
if (!existsSync(entry)) {
  console.error('packages/shared/dist is missing: run `pnpm --filter @quest/shared build` first');
  process.exit(1);
}
const shared = await import(pathToFileURL(entry).href);
const { chapters, errors } = await shared.loadAllLevels(join(ROOT, 'levels'));
if (errors.length > 0) {
  console.error(`the levels do not validate (${errors.length} problems)`);
  process.exit(1);
}

let levels = 0;
let withSolutions = 0;
let references = 0;
let wrong = 0;
let worksButWrong = 0;
let drawn = 0;
const modes = {};
const noHints = [];
for (const c of chapters) {
  for (const l of c.levels) {
    const v = l.level;
    levels++;
    modes[v.mode] = (modes[v.mode] ?? 0) + 1;
    if (!v.hints) noHints.push(v.id);
    if (v.solutions) {
      withSolutions++;
      references++;
      wrong += v.solutions.wrong.length;
      worksButWrong += v.solutions.wrong.filter((w) => w.expect === 'works_but_wrong').length;
    } else {
      drawn++;
    }
  }
}

const count = (dir, keep) => readdirSync(join(ROOT, dir)).filter(keep).length;
const specs = count('docs/specs', (f) => !f.startsWith('_') && !f.startsWith('D-'));
const handoffs = count('docs/handoffs', (f) => !f.startsWith('D-'));

const rows = [
  ['chapters', chapters.length],
  ['levels', levels],
  [
    'levels by mode',
    Object.entries(modes)
      .map(([m, n]) => `${n} ${m}`)
      .join(', '),
  ],
  ['levels that carry their own solutions', withSolutions],
  ['levels that draw another level (no solutions of their own)', drawn],
  ['declared solutions (references + known-wrong)', references + wrong],
  ['  of which marked works_but_wrong', worksButWrong],
  ['levels with no hints', noHints.length ? noHints.join(', ') : 'none'],
  ['task specs outside the ten-day plan', specs],
  ['handoffs outside the ten-day plan', handoffs],
];
for (const [k, v] of rows) console.log(`${k.padEnd(60)} ${v}`);
