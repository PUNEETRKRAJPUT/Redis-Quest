#!/usr/bin/env node
// Scores every committed Economy League entry against a Redis and prints a table per hole (markdown).
//
//   REDIS_URL=redis://127.0.0.1:6379 node scripts/league/score.mjs [hole-dir-or-id ...]
//
// Needs `pnpm --filter @quest/shared build` first. Scoring runs on logical database 7 (LEAGUE_DB overrides it, never 0)
// and EMPTIES that database every time: point it at a throwaway Redis. One node only: a cluster has one database.
// Exit 0: every entry passed its hole's checks and every house entry (par-house.redis) takes exactly par commands.
// Exit 1: an entry failed, a file did not load, or a house entry is missing or not at par. Exit 2: bad usage.
// Under GitHub Actions the tables are also appended to the job summary and failures become annotations.

import { appendFileSync } from 'node:fs';
import { basename, dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  LEAGUE_DB,
  formatLevelError,
  loadLeague,
  openScratch,
  rankBoard,
  scoreEntry,
} from '../../packages/shared/dist/index.js';

const HOUSE = 'par-house';
const repo = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const golf = resolve(process.env.GOLF_DIR ?? join(repo, 'golf'));
const onActions = process.env.GITHUB_ACTIONS === 'true';
const summaryFile = process.env.GITHUB_STEP_SUMMARY;

function usage(message) {
  console.error(`score.mjs: ${message}`);
  console.error(
    'usage: REDIS_URL=redis://host:port node scripts/league/score.mjs [hole-dir-or-id ...]',
  );
  process.exit(2);
}

const url = process.env.REDIS_URL;
if (!url) usage('REDIS_URL is not set');
if (!/^rediss?:\/\//i.test(url))
  usage('REDIS_URL must be redis://host:port (one node; a cluster has one database)');
const db = process.env.LEAGUE_DB === undefined ? LEAGUE_DB : Number(process.env.LEAGUE_DB);
if (!Number.isInteger(db) || db <= 0)
  usage('LEAGUE_DB must be a whole number above 0 (database 0 is never used)');

const wanted = process.argv.slice(2).map((a) => basename(resolve(a)));

let out = '';
function emit(line = '') {
  console.log(line);
  out += `${line}\n`;
}
function annotate(file, line, message) {
  if (!onActions) return;
  const rel = relative(repo, file);
  console.log(
    `::error file=${rel}${line ? `,line=${line}` : ''}::${message.replace(/\r?\n/g, ' ')}`,
  );
}

const vsPar = (n) => (n > 0 ? `-${n}` : n === 0 ? 'par' : `+${-n}`);

let failures = 0;
const { holes: allHoles, errors } = await loadLeague(golf);
for (const e of errors) {
  failures++;
  emit(formatLevelError(e, repo));
  annotate(e.file, e.line, e.message);
}
const holes = wanted.length ? allHoles.filter((h) => wanted.includes(h.id)) : allHoles;
for (const w of wanted) {
  if (!allHoles.some((h) => h.id === w))
    usage(`no hole named ${w} under ${relative(repo, golf)}/holes`);
}

let scratch;
try {
  scratch = await openScratch(url, db);
} catch (e) {
  usage(`cannot connect to ${url}: ${e instanceof Error ? e.message : String(e)}`);
}

let scored = 0;
try {
  for (const h of holes) {
    const rows = [];
    emit(`## ${h.id}: ${h.hole.title} (par ${h.hole.par})`);
    emit();
    if (!h.entries.some((e) => e.handle === HOUSE)) {
      failures++;
      emit(
        `FAIL ${h.id}: entries/${HOUSE}.redis is missing (every hole needs a house entry at par)`,
      );
      annotate(join(h.dir, 'hole.yaml'), 1, `${h.id} needs entries/${HOUSE}.redis`);
    }
    for (const entry of h.entries) {
      const r = await scoreEntry({ id: h.id, hole: h.hole }, entry, scratch.run, { scratchDb: db });
      const file = join(h.dir, 'entries', `${entry.handle}.redis`);
      if (!r.ok) {
        failures++;
        emit(`FAIL ${h.id} ${entry.handle}: ${r.message}`);
        annotate(file, r.line ?? 1, r.message);
        continue;
      }
      scored++;
      if (entry.handle === HOUSE && r.commands !== h.hole.par) {
        failures++;
        const msg = `the house entry takes ${r.commands} commands but par is ${h.hole.par}`;
        emit(`FAIL ${h.id} ${HOUSE}: ${msg}`);
        annotate(file, 1, msg);
      }
      rows.push({
        handle: entry.handle,
        commands: r.commands,
        bytes: r.bytes,
        chars: r.chars,
        underPar: r.underPar,
      });
    }
    emit();
    emit('| rank | handle | commands | bytes | chars | vs par |');
    emit('| ---- | ------ | -------- | ----- | ----- | ------ |');
    for (const row of rankBoard(rows)) {
      emit(
        `| ${row.rank} | ${row.handle} | ${row.commands} | ${row.bytes} | ${row.chars} | ${vsPar(row.underPar)} |`,
      );
    }
    emit();
  }
} finally {
  await scratch.close();
}

emit(
  `league: ${holes.length} hole(s), ${scored} entr${scored === 1 ? 'y' : 'ies'} scored, ${failures} problem(s)`,
);
if (summaryFile) {
  try {
    appendFileSync(summaryFile, `${out}\n`);
  } catch {
    // the summary is a courtesy; the log has everything
  }
}
process.exit(failures > 0 ? 1 : 0);
