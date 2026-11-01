#!/usr/bin/env node
// levels:validate [dir ...]
// Validates level trees or single chapter directories and prints every problem as
// `path:line:col field.path: message`. Exit 1 if there is any problem, 2 on bad usage.

import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { chapterOrder, interviewReferenceErrors, loadAllLevels, type LoadedChapter } from './loader.js';
import { compareErrors, formatLevelError, type LevelError } from './source.js';

function findRepoRoot(from: string): string | undefined {
  let dir = resolve(from);
  for (;;) {
    if (existsSync(join(dir, 'pnpm-workspace.yaml'))) return dir;
    const up = dirname(dir);
    if (up === dir) return undefined;
    dir = up;
  }
}

async function main(argv: string[]): Promise<number> {
  if (argv.includes('-h') || argv.includes('--help')) {
    console.log('usage: levels:validate [dir ...]   (default: <repo>/levels)');
    return 0;
  }
  // pnpm runs package scripts from the package directory; INIT_CWD is where the user typed the command.
  const cwd = process.env.INIT_CWD ?? process.cwd();
  const repoRoot = findRepoRoot(cwd) ?? findRepoRoot(process.cwd());
  const base = repoRoot ?? cwd;
  const dirs = argv.length ? argv.map((a) => resolve(cwd, a)) : [join(base, 'levels')];

  const errors: LevelError[] = [];
  const chapters = new Map<string, LoadedChapter>();
  for (const d of dirs) {
    const r = await loadAllLevels(d, { skipInterviewCheck: true });
    errors.push(...r.errors);
    for (const c of r.chapters) chapters.set(c.dir, c);
  }
  // rebuild_of may point into another directory given on the same command line, so check the union.
  errors.push(...(await interviewReferenceErrors([...chapters.values()].sort(chapterOrder))));
  errors.sort(compareErrors);
  for (const e of errors) console.log(formatLevelError(e, base));

  const levelCount = [...chapters.values()].reduce((n, c) => n + c.levels.length, 0);
  if (errors.length) {
    console.log(`levels:validate: ${errors.length} problem(s)`);
    return 1;
  }
  console.log(`levels:validate: OK (${chapters.size} chapter(s), ${levelCount} level(s))`);
  return 0;
}

main(process.argv.slice(2)).then(
  (code) => process.exit(code),
  (e: unknown) => {
    console.error(e);
    process.exit(2);
  },
);
