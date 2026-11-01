#!/usr/bin/env node
// Level grading harness (G-01): plays every declared solution of a chapter, or of one level, through the
// real engine over HTTP and prints a truth table (level, solution, declared verdict, engine verdict,
// PASS / MISMATCH / SKIPPED). A level is only done when its table has no MISMATCH row.
//
//   scripts/grade/grade.sh [--engine URL] [--workspace DIR] [--levels DIR] [--run-ops] [--json FILE]
//                          <chapter-dir | level-id>...
//
// It reads levels with the @quest/shared loader (built output in packages/shared/dist) and never parses
// YAML itself. The engine must already be running with the same level files mounted. Exit codes:
// 0 every graded solution matches its declaration, 1 at least one MISMATCH, 2 the tool could not run.
/* global fetch, setTimeout, clearTimeout, setInterval, clearInterval, WebSocket, AbortSignal, process, console */
import { spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { basename, dirname, extname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..', '..');
const shared = await import(pathToFileURL(join(ROOT, 'packages/shared/dist/index.js')).href).catch(
  (e) => {
    console.error(
      `cannot load packages/shared/dist (run: pnpm --filter @quest/shared build): ${e.message}`,
    );
    process.exit(2);
  },
);
const { loadChapter, renderTemplate, resolveLevelPath } = shared;

// ---- arguments ------------------------------------------------------------------------------------

const USAGE = `usage: scripts/grade/grade.sh [options] <chapter-dir | level-id>...
  --engine URL      engine origin as the proxy serves it (default $GRADE_ENGINE or http://127.0.0.1:3500)
  --workspace DIR   write code solutions straight into this workspace directory instead of PUT /api/workspace/file
  --levels DIR      where to look up level ids (default: <repo>/levels, including _examples/*)
  --run-ops         also run .sh ops solutions on this Mac (they run docker compose against the default project)
  --json FILE       also write the table as JSON
  -h, --help        this text`;

const opts = {
  engine: process.env.GRADE_ENGINE ?? 'http://127.0.0.1:3500',
  workspace: null,
  levels: join(ROOT, 'levels'),
  runOps: false,
  json: null,
  targets: [],
};
{
  const a = process.argv.slice(2);
  for (let i = 0; i < a.length; i++) {
    const k = a[i];
    const val = () => {
      if (i + 1 >= a.length) usageExit(`${k} needs a value`);
      return a[++i];
    };
    if (k === '--engine') opts.engine = val();
    else if (k === '--workspace') opts.workspace = resolve(val());
    else if (k === '--levels') opts.levels = resolve(val());
    else if (k === '--json') opts.json = resolve(val());
    else if (k === '--run-ops') opts.runOps = true;
    else if (k === '-h' || k === '--help') {
      console.log(USAGE);
      process.exit(0);
    } else if (k.startsWith('--')) usageExit(`unknown option ${k}`);
    else opts.targets.push(k);
  }
  if (!opts.targets.length) usageExit('give at least one chapter directory or level id');
  opts.engine = opts.engine.replace(/\/+$/, '');
}
function usageExit(msg) {
  console.error(`${msg}\n${USAGE}`);
  process.exit(2);
}

// ---- small helpers --------------------------------------------------------------------------------

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const t0 = Date.now();
const stamp = () => `${String(Math.floor((Date.now() - t0) / 1000)).padStart(4)}s`;
const log = (m) => console.log(`${stamp()}  ${m}`);

async function api(method, path, body, timeoutMs = 900_000) {
  let res;
  try {
    res = await fetch(`${opts.engine}${path}`, {
      method,
      headers: body === undefined ? {} : { 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (e) {
    throw new Error(`${method} ${path}: ${e.message} (is the engine up at ${opts.engine}?)`);
  }
  let json = null;
  try {
    json = await res.json();
  } catch {
    // not JSON
  }
  return { status: res.status, body: json };
}

/** Quotes an argv the way redis-cli would read it back, for /api/cli. */
function quoteArg(s) {
  return /^[^\s"'\\]+$/.test(s) ? s : `"${s.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

// ---- find the levels to grade ---------------------------------------------------------------------

async function chaptersUnder(root) {
  const dirs = [];
  const scan = (d) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      if (!e.isDirectory()) continue;
      const p = join(d, e.name);
      if (existsSync(join(p, 'chapter.yaml'))) dirs.push(p);
    }
  };
  if (!existsSync(root)) return [];
  scan(root);
  if (existsSync(join(root, '_examples'))) scan(join(root, '_examples'));
  const out = [];
  for (const d of dirs) {
    const r = await loadChapter(d);
    if (r.chapter) out.push(r);
  }
  return out;
}

const chapters = []; // LoadedChapter[] in the order requested, with `only` = level ids to grade (null = all)
async function resolveTargets() {
  let known = null;
  for (const t of opts.targets) {
    const asDir = resolve(t);
    if (
      existsSync(asDir) &&
      statSync(asDir).isDirectory() &&
      existsSync(join(asDir, 'chapter.yaml'))
    ) {
      const r = await loadChapter(asDir);
      if (r.errors.length)
        throw new Error(
          `${t} has level errors (run pnpm --filter @quest/shared levels:validate):\n${r.errors.map((e) => `  ${e.message ?? JSON.stringify(e)}`).join('\n')}`,
        );
      chapters.push({ lc: r.chapter, only: null });
      continue;
    }
    known ??= await chaptersUnder(opts.levels);
    let found = null;
    for (const r of known) {
      const lv = r.chapter.levels.find((l) => l.level.id === t);
      if (lv) found = { lc: r.chapter, only: new Set([t]) };
    }
    if (!found)
      throw new Error(
        `${t}: not a chapter directory and no level with that id under ${opts.levels}`,
      );
    const prev = chapters.find((c) => c.lc.dir === found.lc.dir && c.only);
    if (prev) prev.only.add(t);
    else chapters.push(found);
  }
}

// ---- engine plumbing ------------------------------------------------------------------------------

let player = null;
let slotFiles = null;

// Fallback copy of the slot -> workspace file column of app/src/slots/registry.ts (docs/handoffs/P0-07.md).
// The live app is asked first (GET /app/slots exposes `file`), so a new slot needs no change here.
const SLOT_FILE_TABLE = {
  'onboarding.registerUser': 'ch1/register.js',
  'cache.getPlayerStats': 'ch2/cache.js',
  'cache.invalidatePlayerStats': 'ch2/invalidate.js',
  'prefetch.getFixtures': 'ch2/prefetch.js',
  'session.create': 'ch3/session-create.js',
  'session.get': 'ch3/session-get.js',
  'prefetch.bulkLoad': 'ch2/prefetch-bulk.js',
  'prefetch.applyChange': 'ch2/prefetch-apply.js',
  'session.destroy': 'ch3/session-destroy.js',
  'session.destroyAll': 'ch3/session-destroy-all.js',
  'leaderboard.top': 'ch3/leaderboard.js',
  'ratelimit.allow': 'ch3/ratelimit.js',
};

async function loadSlotFiles() {
  slotFiles = { ...SLOT_FILE_TABLE };
  const r = await api('GET', '/app/slots', undefined, 5000).catch(() => null);
  if (r && r.status === 200 && Array.isArray(r.body?.slots)) {
    for (const s of r.body.slots)
      if (s.name && s.file && !s.exportName?.startsWith?.('x:')) slotFiles[s.name] = s.file;
  }
}

async function ensurePlayer() {
  const g = await api('GET', '/api/progress');
  if (g.status === 200) {
    player = g.body.player;
    log(`reusing player ${player.id} (${player.name})`);
    return;
  }
  if (g.status === 503)
    throw new Error(`the engine reports levels_invalid: ${JSON.stringify(g.body).slice(0, 600)}`);
  const c = await api('POST', '/api/player', { name: 'Grader' });
  if (c.status !== 201)
    throw new Error(`POST /api/player -> ${c.status} ${JSON.stringify(c.body)}`);
  player = c.body.player;
  log(`created player ${player.id}`);
}

const envForTemplates = () => {
  const e = {};
  for (const k of ['REDIS_PORT', 'PROXY_PORT', 'INSIGHT_PORT', 'PG_PORT'])
    if (process.env[k]) e[k] = process.env[k];
  return e;
};
const ctxOf = (lv) => ({
  player: { id: player.id, name: player.name },
  level: { id: lv.level.id },
  chapter: { id: lv.chapterId },
  env: envForTemplates(),
});

/** Completes every level before `id` in the engine's play order (ENGINE_DEV=1), so `id` can be started. */
async function ensureUnlocked(id) {
  const c = await api('GET', '/api/chapters');
  if (c.status !== 200)
    throw new Error(`GET /api/chapters -> ${c.status} ${JSON.stringify(c.body).slice(0, 300)}`);
  const flat = c.body.chapters.flatMap((ch) => ch.levels);
  const idx = flat.findIndex((l) => l.id === id);
  if (idx < 0)
    throw new Error(
      `the engine does not know level ${id}; it must mount the same level files this tool reads`,
    );
  for (let j = 0; j < idx; j++) {
    if (flat[j].status === 'passed') continue;
    const r = await api('POST', `/api/levels/${flat[j].id}/complete`);
    if (r.status !== 200)
      throw new Error(
        `cannot unlock ${id}: POST /api/levels/${flat[j].id}/complete -> ${r.status} (the engine needs ENGINE_DEV=1)`,
      );
  }
}

async function start(id) {
  const r = await api('POST', `/api/levels/${id}/start`);
  if (r.status !== 200)
    throw new Error(`start ${id} -> ${r.status} ${JSON.stringify(r.body).slice(0, 400)}`);
}

async function verify(id, answers) {
  for (let attempt = 0; attempt < 15; attempt++) {
    const r = await api('POST', `/api/levels/${id}/verify`, { answers });
    if (r.status === 409 && r.body?.error === 'verify_in_progress') {
      await sleep(2000);
      continue;
    }
    if (r.status !== 200) return { verdict: `HTTP ${r.status}`, checks: [], httpBody: r.body };
    return r.body;
  }
  return { verdict: 'HTTP 409', checks: [], httpBody: { error: 'verify_in_progress' } };
}

async function cli(command) {
  const r = await api('POST', '/api/cli', { command });
  if (r.status !== 200)
    throw new Error(`/api/cli ${command} -> ${r.status} ${JSON.stringify(r.body)}`);
  return r.body;
}

// ---- the learner's moves --------------------------------------------------------------------------

function redisLines(file, ctx) {
  return readFileSync(file, 'utf8')
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('#'))
    .map((l) => renderTemplate(l, ctx));
}

async function runRedisFile(file, ctx) {
  const out = [];
  for (const line of redisLines(file, ctx)) out.push({ line, ...(await cli(line)) });
  return out;
}

/** What the UI does for the learner after they act in the terminal (the harness stands in for the UI). */
async function uiActions(lv, transcript) {
  const names = lv.level.verify
    .filter((v) => v.type === 'event' && v.kind === 'custom')
    .map((v) => v.match?.name);
  const notes = [];
  for (const n of names) {
    if (n === 'progress_restored') {
      // The learner accepts the UI's offer: POST /api/progress/restore. The harness does exactly that and
      // does NOT post the event itself, so an engine or UI that never emits it shows up as a mismatch.
      const r = await api('POST', '/api/progress/restore');
      notes.push(`UI accepted the restore offer (POST /api/progress/restore -> ${r.status})`);
    } else if (n === 'ui_connected') {
      await api('POST', '/api/events', { kind: 'custom', name: 'ui_connected' });
      notes.push('UI posted ui_connected');
    } else if (n === 'cli_ping') {
      if (!transcript.some((t) => t.line.toUpperCase() === 'PING'))
        notes.push('solution never sent PING');
    } else if (n === 'load_finished' || n === 'script_killed' || n === 'redis_busy') {
      // The harness produces these just before verify (verifyWithEvents), through the engine's own routes.
    } else if (n) notes.push(`event ${n} is produced by the solution itself (nothing simulated)`);
  }
  return notes;
}

const wipes = (transcript) => transcript.some((t) => /^(FLUSHALL|FLUSHDB)\b/i.test(t.line));

/** Typed answers and quiz picks. `good`: the solution is declared right or works_but_wrong, so every answer is correct. */
async function buildAnswers(lv, good) {
  const answers = {};
  const ctx = ctxOf(lv);
  for (let i = 0; i < lv.level.verify.length; i++) {
    const v = lv.level.verify[i];
    if (v.type === 'answer') {
      if (!good) {
        answers[String(i)] = 'not-the-answer';
        continue;
      }
      const argv = v.expected.cmd.map((a) => renderTemplate(String(a), ctx));
      const r = await cli(argv.map(quoteArg).join(' '));
      answers[String(i)] = r.reply;
    } else if (v.type === 'quiz') {
      if (good) answers[String(i)] = v.correct.length > 1 ? v.correct : v.correct[0];
      else {
        const wrong = v.options.find((o) => !v.correct.includes(o.id));
        answers[String(i)] = wrong ? wrong.id : '';
      }
    }
  }
  return answers;
}

// ---- events that happen during the wait (E-01) ---------------------------------------------------
// A solution declared right or works_but_wrong gets the live event its level waits for; a wrong one gets
// nothing (the same rule `answer` and `quiz` follow). docs/grading.md, "Events the harness produces".

const eventVerifiers = (lv) =>
  lv.level.verify.map((v, index) => ({ v, index })).filter(({ v }) => v.type === 'event');

const GRADER_INSTANCE = 'grader-instance-2';
let lastFakePushAt = 0;

async function pushFakeInstance() {
  const at = Math.floor(Date.now() / 1000) * 1000;
  lastFakePushAt = Date.now();
  return api(
    'POST',
    '/internal/metrics',
    {
      instance: GRADER_INSTANCE,
      instanceId: GRADER_INSTANCE,
      at,
      windowMs: 1000,
      routes: {},
    },
    5000,
  );
}

/** service_scaled: a second app instance appears (fake pushes), and the engine's real emitter fires. */
async function simulateScale(lv, wanted) {
  // A previous good solution's fake instance stays "live" for 5 s after its last push and the engine notices it
  // going quiet on a 2 s timer, so wait until it is gone or the 1 to N event would not fire again.
  const quiet = 8000 - (Date.now() - lastFakePushAt);
  if (lastFakePushAt && quiet > 0) {
    log(`      ... waiting ${Math.ceil(quiet / 1000)} s for ${GRADER_INSTANCE} to expire`);
    await sleep(quiet);
  }
  const since = new Date().toISOString();
  const before = await api('GET', '/api/metrics?seconds=5', undefined, 5000);
  const seen = before.body?.instances ?? [];
  for (let i = 0; i < 3; i++) {
    const r = await pushFakeInstance();
    if (r.status !== 200)
      return `fake push to /internal/metrics -> ${r.status} ${JSON.stringify(r.body)}`;
    await sleep(1000);
  }
  const ev = await api('GET', `/api/events?since=${encodeURIComponent(since)}`, undefined, 5000);
  const hit = (ev.body?.events ?? ev.body ?? []).find?.(
    (e) =>
      e?.data?.kind === 'service_scaled' &&
      (wanted === undefined || String(e.data.data?.instances) === String(wanted)),
  );
  return hit
    ? `fake pushes as ${GRADER_INSTANCE} (instances the engine already knew: ${seen.join(', ') || 'none'}); engine emitted service_scaled instances ${hit.data.data?.instances}`
    : `NOTE service_scaled: engine did not emit service_scaled${wanted === undefined ? '' : ` with instances ${wanted}`} after fake pushes (instances the engine already knew: ${seen.join(', ') || 'none'}; run with exactly ${Math.max(0, Number(wanted ?? 2) - 1)} app instance(s))`;
}

const DEFAULT_CHANNEL_MESSAGE =
  '{"matchId":"m-041","seq":1,"over":1,"ball":1,"runs":4,"batter":"p-028"}';

/**
 * channel_message: the engine only sees a message while it waits (it SUBSCRIBEs during the check), so the
 * harness acts during verify: when verify_check_started arrives for that verifier's index it PUBLISHes once a
 * second until the check finishes (at most 10 times).
 */
async function verifyWithChannelPublisher(lv, id, answers, channels) {
  const ctx = ctxOf(lv);
  const jobs = new Map(); // verifier index -> { channel, message, delay, timer, started, sent }
  for (const { v, index } of channels) {
    if (v.kind === 'key_expired') {
      // The engine sees an expired-key event only while it waits, so the key is set during the wait with a
      // one second life, once (a second SET would make a new key after the first one expired).
      const key = renderTemplate(String(v.match.key), ctx);
      // Redis deletes an expired key when its background sampling finds it or when something reads it; with
      // hundreds of volatile keys the sampling can lag seconds, so the follow-up ticks read the key, which
      // deletes it at once and publishes the event (keyspace-notifications page: "on access or background scan").
      jobs.set(index, {
        channel: key,
        command: `SET ${quoteArg(key)} harness-probe PX 800`,
        followUp: `EXISTS ${quoteArg(key)}`,
        timer: null,
        delay: null,
        started: false,
        sent: 0,
      });
      continue;
    }
    const channel = renderTemplate(String(v.match.channel), ctx);
    const m = v.match.message;
    const message =
      m === undefined
        ? DEFAULT_CHANNEL_MESSAGE
        : renderTemplate(typeof m === 'string' ? m : JSON.stringify(m), ctx);
    jobs.set(index, {
      channel,
      command: `PUBLISH ${quoteArg(channel)} ${quoteArg(message)}`,
      followUp: `PUBLISH ${quoteArg(channel)} ${quoteArg(message)}`,
      timer: null,
      delay: null,
      started: false,
      sent: 0,
    });
  }
  const stop = (job) => {
    clearTimeout(job.delay);
    clearInterval(job.timer);
    job.delay = null;
    job.timer = null;
  };
  const listener = (name, d) => {
    if (d.levelId !== id) return;
    const job = jobs.get(d.index);
    if (!job) return;
    if (name === 'verify_check_started' && !job.started) {
      job.started = true;
      const publish = () => {
        if (job.sent >= 10) return stop(job);
        const command = job.sent === 0 ? job.command : job.followUp;
        job.sent += 1;
        cli(command).catch(() => undefined);
      };
      // SUBSCRIBE needs a moment to land after the check starts, so the first PUBLISH is not immediate.
      job.delay = setTimeout(() => {
        publish();
        if (job.sent < 10) job.timer = setInterval(publish, 1000);
      }, 300);
    } else if (name === 'verify_check_finished') {
      stop(job);
    }
  };
  progressListeners.add(listener);
  let out;
  try {
    out = await verify(id, answers);
  } finally {
    progressListeners.delete(listener);
    for (const job of jobs.values()) stop(job);
  }
  const sent = [...jobs.values()].map((j) => `${j.sent} on ${j.channel}`).join(', ');
  return { out, note: `harness published ${sent}` };
}

/** custom ticker_gap: a subscriber that was paused sees seq jump from 1 to 4. A-02's route does the pausing. */
async function tickerGapDance() {
  const channel = 'score:match:m-041';
  const msg = (seq) =>
    JSON.stringify({ matchId: 'm-041', seq, over: 1, ball: seq, runs: 1, batter: 'p-028' });
  const publish = (seq) => cli(`PUBLISH ${channel} ${quoteArg(msg(seq))}`);
  await publish(1);
  const resub = api('POST', '/app/ticker/resubscribe', { matchId: 'm-041', pauseMs: 1000 }, 15_000);
  await sleep(200);
  await publish(2);
  await publish(3);
  const r = await resub;
  if (r.status === 404) {
    log('NOTE ticker_gap: /app/ticker/resubscribe not available (A-02 not merged)');
    return 'NOTE ticker_gap: /app/ticker/resubscribe not available (A-02 not merged)';
  }
  await publish(4);
  return `ticker_gap dance: resubscribe -> ${r.status}, published seq 1, 2, 3, 4`;
}

/**
 * custom load_finished (E-02): the learner ran the traffic. The harness starts a 5 s on-demand run before verify and
 * waits until it is over (the verifier's guard would 409 otherwise), so the engine's own load_finished is what the
 * level sees. A 409 means a verification or another run is going: wait and try again.
 */
async function loadDance(lv, scenarioTemplate) {
  const scenario = renderTemplate(String(scenarioTemplate), ctxOf(lv));
  // The run goes against the solution's code, as a learner's own "run traffic again after the fix" does: with
  // the level's slots off, the traffic would exercise the planted fault (ch4b-06's leaked connections) and the
  // level's own checks would then see that damage. Put the level's slots on for the run, and put them back after.
  const own = [...new Set(lv.level.verify.map((v) => v.slot).filter((x) => typeof x === 'string'))];
  let before = null;
  if (own.length) {
    const cur = await api('GET', '/api/slots', undefined, 5000);
    before = Array.isArray(cur.body?.active) ? cur.body.active : [];
    await api('PUT', '/api/slots', { active: [...new Set([...before, ...own])] }, 5000);
    await sleep(2500); // the app polls the engine's config every 2 s
  }
  const restore = async () => {
    if (before) await api('PUT', '/api/slots', { active: before }, 5000);
  };
  let started = null;
  for (let attempt = 0; attempt < 15 && !started; attempt++) {
    const r = await api('POST', '/api/load/start', { scenario, durationSec: 5 }, 15_000);
    if (r.status === 202) started = r.body;
    else if (r.status === 409) await sleep(2000);
    else {
      await restore();
      return `NOTE load_finished: POST /api/load/start answered ${r.status} ${JSON.stringify(r.body)}`;
    }
  }
  if (!started) {
    await restore();
    return 'NOTE load_finished: POST /api/load/start stayed 409 for 30 s';
  }
  const deadline = Date.now() + 40_000;
  let last = null;
  while (Date.now() < deadline) {
    await sleep(500);
    const st = await api('GET', '/api/load/status', undefined, 5000);
    if (st.status === 200 && !st.body?.running) {
      last = st.body?.last ?? null;
      break;
    }
  }
  await restore();
  return last
    ? `load dance: ran ${scenario} for 5 s with slots ${own.join(', ') || '(none)'} on (${last.requests} requests, ${Math.round(last.rps)} req/s, p99 ${last.p99Ms} ms, ${last.errors} errors)`
    : `NOTE load_finished: the ${scenario} run did not report within 40 s`;
}

/**
 * custom redis_busy / script_killed (E-02): the learner finds the script that freezes Redis and kills it. The
 * harness starts A-04's blocking route without awaiting it, waits past busy-reply-threshold (5 s by default), runs
 * PING through /api/cli (Redis answers BUSY, so the engine emits redis_busy), then SCRIPT KILL (OK, so the engine
 * emits script_killed), and finally waits for the blocked request to end.
 */
const BUSY_ROUTE = '/app/oncall/badges/recompute';
async function busyDance() {
  const first = api('POST', BUSY_ROUTE, {}, 60_000).catch((e) => ({
    status: 0,
    body: { error: e.message },
  }));
  const early = await Promise.race([first, sleep(1000).then(() => null)]);
  if (early && early.status === 404) {
    const note = `NOTE script_killed: ${BUSY_ROUTE} not available (A-04 not merged)`;
    log(note);
    return note;
  }
  await sleep(5500);
  const ping = await cli('PING');
  const kill = await cli('SCRIPT KILL');
  const ended = await Promise.race([first, sleep(15_000).then(() => null)]);
  return `busy dance: ${BUSY_ROUTE} started, PING -> ${ping.reply}, SCRIPT KILL -> ${kill.reply}, blocked request ended with ${ended ? ended.status : 'no answer within 15 s'}`;
}

/** verify() plus whatever live events a good solution's level waits for. Returns { out, note }. */
async function verifyWithEvents(lv, id, answers, good) {
  const evs = good ? eventVerifiers(lv) : [];
  const notes = [];
  const scaled = evs.find(({ v }) => v.kind === 'service_scaled');
  if (scaled) notes.push(await simulateScale(lv, scaled.v.match?.instances));
  if (evs.some(({ v }) => v.kind === 'custom' && v.match?.name === 'ticker_gap'))
    notes.push(await tickerGapDance());
  const loaded = evs.find(({ v }) => v.kind === 'custom' && v.match?.name === 'load_finished');
  if (loaded) notes.push(await loadDance(lv, loaded.v.match?.scenario ?? ''));
  if (
    evs.some(
      ({ v }) =>
        v.kind === 'custom' &&
        (v.match?.name === 'script_killed' || v.match?.name === 'redis_busy'),
    )
  )
    notes.push(await busyDance());
  const channels = evs.filter(
    ({ v }) =>
      (v.kind === 'channel_message' && v.match?.channel) ||
      (v.kind === 'key_expired' && v.match?.key),
  );
  if (channels.length) {
    const r = await verifyWithChannelPublisher(lv, id, answers, channels);
    notes.push(r.note);
    return { out: r.out, note: notes.join('; ') };
  }
  return { out: await verify(id, answers), note: notes.join('; ') };
}

// ---- code solutions: slot -> workspace file -------------------------------------------------------

const touched = new Map(); // rel -> original content (string) or null when it did not exist

function slotOf(lv) {
  const slots = [
    ...new Set(lv.level.verify.filter((v) => typeof v.slot === 'string').map((v) => v.slot)),
  ];
  if (slots.length === 0) return { err: 'no slot' };
  const unknown = slots.find((s) => !slotFiles[s]);
  if (unknown) return { err: `unknown slot ${unknown}` };
  const list = slots.map((slot) => ({ slot, rel: slotFiles[slot] }));
  return { slots: list, rel: list[0].rel };
}

/**
 * Several slots, one solution file ("bundle"): the bundle's named export for a slot is the part of the slot
 * name after the first dot (prefetch.bulkLoad -> bulkLoad). The bundle goes next to the first slot's file as
 * _bundle-<level-id>-<solution>.js and each slot's own file becomes a two-line shim that re-exports that name
 * as its default export. docs/grading.md, "Bundle solutions".
 */
function bundleFiles(lv, solPath, slots, source) {
  const dir = dirname(slots[0].rel);
  const bundleName = `_bundle-${lv.level.id}-${basename(solPath, extname(solPath))}.js`;
  const files = [[`${dir === '.' ? '' : `${dir}/`}${bundleName}`, source]];
  for (const { slot, rel } of slots) {
    const exp = slot.slice(slot.indexOf('.') + 1);
    // Relative path from the shim's directory to the bundle (slot files of one level may sit in different dirs).
    const from = dirname(rel);
    const bdir = dirname(files[0][0]);
    const up =
      from === '.'
        ? ''
        : from
            .split('/')
            .map(() => '..')
            .join('/') + '/';
    const spec = from === bdir ? `./${bundleName}` : `${up || './'}${files[0][0]}`;
    files.push([
      rel,
      `import * as bundle from '${spec}'; // grade.mjs bundle shim for ${slot}\nexport default bundle.${exp};\n`,
    ]);
  }
  return files;
}

async function readWorkspace(rel) {
  if (opts.workspace) {
    const f = join(opts.workspace, rel);
    return existsSync(f) ? readFileSync(f, 'utf8') : null;
  }
  const r = await api('GET', `/api/workspace/file?path=${encodeURIComponent(rel)}`);
  return r.status === 200 ? r.body.content : null;
}

async function writeWorkspace(rel, content, settle = true) {
  if (!touched.has(rel)) touched.set(rel, await readWorkspace(rel));
  if (opts.workspace) {
    const f = join(opts.workspace, rel);
    mkdirSync(dirname(f), { recursive: true });
    writeFileSync(f, content);
  } else {
    const r = await api('PUT', `/api/workspace/file?path=${encodeURIComponent(rel)}`, { content });
    if (r.status !== 200)
      throw new Error(`PUT /api/workspace/file ${rel} -> ${r.status} ${JSON.stringify(r.body)}`);
  }
  // The app polls workspace files once a second; let it see this version before the engine activates the slot.
  if (settle) await sleep(2000);
}

async function restoreWorkspace() {
  for (const [rel, original] of touched) {
    if (opts.workspace) {
      if (original === null) rmSync(join(opts.workspace, rel), { force: true });
      else writeFileSync(join(opts.workspace, rel), original);
    } else {
      // The API cannot delete: an empty file has no default export, so the app falls back to its baseline.
      await api('PUT', `/api/workspace/file?path=${encodeURIComponent(rel)}`, {
        content: original ?? '',
      });
    }
  }
  touched.clear();
}

// ---- recording ------------------------------------------------------------------------------------

const rows = [];

function feedbackOf(out) {
  const fb = [];
  for (const c of out.checks ?? []) {
    const tag = c.skipped
      ? 'skip'
      : c.type === 'antipattern'
        ? c.ok
          ? 'ok'
          : 'HIT'
        : c.ok
          ? 'ok'
          : 'fail';
    fb.push({ index: c.index, type: c.type, tag, message: String(c.message ?? '') });
  }
  if (out.httpBody)
    fb.push({
      index: -1,
      type: 'http',
      tag: 'fail',
      message: JSON.stringify(out.httpBody).slice(0, 600),
    });
  return fb;
}

function record(lv, solution, declared, out, extra = {}) {
  const got = out?.verdict ?? 'n/a';
  const row = {
    level: lv.level.id,
    chapter: lv.chapterId,
    mode: lv.level.mode,
    solution,
    declared,
    engine: got,
    result: got === declared ? 'PASS' : 'MISMATCH',
    because: extra.because ?? '',
    note: extra.note ?? '',
    ms: out?.durationMs ?? null,
    feedback: feedbackOf(out ?? {}),
  };
  rows.push(row);
  const line = `${row.result === 'PASS' ? 'PASS    ' : 'MISMATCH'} ${row.level}  ${solution}: declared ${declared}, engine ${got}${row.note ? `  [${row.note}]` : ''}`;
  log(line);
  if (row.result === 'MISMATCH')
    for (const f of row.feedback)
      log(`          [${f.tag}] #${f.index} ${f.type}: ${f.message.split('\n').join(' | ')}`);
  return row;
}

function skipped(lv, solution, declared, why, because = '') {
  rows.push({
    level: lv.level.id,
    chapter: lv.chapterId,
    mode: lv.level.mode,
    solution,
    declared,
    engine: '-',
    result: 'SKIPPED',
    because,
    note: why,
    ms: null,
    feedback: [],
  });
  log(`SKIPPED  ${lv.level.id}  ${solution}: ${why}`);
}

// ---- grading one level ----------------------------------------------------------------------------

async function gradeLevel(lv) {
  const x = lv.level;
  const id = x.id;
  log(`== ${id} (${x.mode})`);

  if (x.mode === 'decision') {
    await ensureUnlocked(id);
    const quizzes = x.verify.map((v, i) => [v, i]).filter(([v]) => v.type === 'quiz');
    const ref = {};
    for (const [v, i] of quizzes) ref[String(i)] = v.correct.length > 1 ? v.correct : v.correct[0];
    await start(id);
    record(lv, `reference [${x.solutions.reference.join(', ')}]`, 'right', await verify(id, ref));
    for (const w of x.solutions.wrong) {
      const answers = { ...ref };
      for (const [v, i] of quizzes)
        if (v.options.some((o) => o.id === w.option)) answers[String(i)] = w.option;
      await start(id);
      record(lv, `option ${w.option}`, w.expect, await verify(id, answers), { because: w.because });
    }
    await api('POST', `/api/levels/${id}/complete`);
    return;
  }

  const sols = [
    { path: x.solutions.reference, expect: 'right', because: '' },
    ...x.solutions.wrong.map((w) => ({ ...w })),
  ];
  // A level that waits for Redis to go away and come back needs a real `docker compose stop redis`; nothing the
  // harness can do through the engine produces that, so it is graded by hand (ch2-10 was, with a real outage).
  const needsOutage = lv.level.verify.some(
    (v) => v.type === 'event' && (v.kind === 'redis_disconnect' || v.kind === 'redis_reconnect'),
  );
  if (needsOutage) {
    for (const s of sols)
      skipped(
        lv,
        s.path,
        s.expect,
        'SKIPPED (needs a real Redis outage: graded by hand)',
        s.because,
      );
    await ensureUnlocked(id);
    await api('POST', `/api/levels/${id}/complete`);
    return;
  }
  let unlocked = false;
  for (const s of sols) {
    const ext = extname(s.path);
    const label = s.path;
    if (ext === '.sh' && !opts.runOps) {
      skipped(lv, label, s.expect, 'SKIPPED (ops shell)', s.because);
      continue;
    }
    if (!unlocked) {
      await ensureUnlocked(id);
      unlocked = true;
    }
    const file = resolveLevelPath(lv, s.path);
    const good = s.expect !== 'wrong';
    let transcript = [];
    let note = '';
    if (ext === '.js' || ext === '.mjs') {
      const sl = slotOf(lv);
      if (sl.err) {
        skipped(lv, label, s.expect, `SKIPPED (${sl.err}: nowhere to put the solution)`, s.because);
        continue;
      }
      await start(id);
      const source = readFileSync(file, 'utf8');
      if (sl.slots.length === 1) {
        await writeWorkspace(sl.rel, source);
        note = `workspace/${sl.rel}`;
      } else {
        const files = bundleFiles(lv, s.path, sl.slots, source);
        for (let k = 0; k < files.length; k++)
          await writeWorkspace(files[k][0], files[k][1], k === files.length - 1);
        note = `bundle ${files[0][0]} + ${files.length - 1} shims`;
      }
    } else if (ext === '.redis') {
      await start(id);
      transcript = await runRedisFile(file, ctxOf(lv));
      // FT.CREATE indexes the documents that already exist in the background; a check that counts them a
      // few milliseconds later can see 0. Give it the moment a person typing the next command would.
      if (transcript.some((t) => /^FT\.CREATE\b/i.test(t.line))) {
        await sleep(1500);
        note = [note, 'waited 1.5 s after FT.CREATE for background indexing']
          .filter(Boolean)
          .join('; ');
      }
    } else if (ext === '.sh') {
      await start(id);
      log(`running ${s.path} on this Mac (--run-ops)`);
      const r = spawnSync('bash', [file], { cwd: ROOT, stdio: 'inherit' });
      note = `ran with --run-ops, exit ${r.status}`;
    } else {
      skipped(lv, label, s.expect, `SKIPPED (unknown solution type ${ext})`, s.because);
      continue;
    }
    if (good) {
      const ui = await uiActions(lv, transcript);
      if (ui.length) note = [note, ...ui].filter(Boolean).join('; ');
    }
    const answers = await buildAnswers(lv, good);
    const live = await verifyWithEvents(lv, id, answers, good);
    const out = live.out;
    if (live.note) note = [note, live.note].filter(Boolean).join('; ');
    record(lv, label, s.expect, out, { because: s.because, note });
    // Bundle shims and the bundle are removed (or emptied through the API) after each solution.
    if (touched.size > 1) await restoreWorkspace();
    // A solution that changed server config (ops levels such as ch2-09) must not poison later levels: a wrong one
    // that sets noeviction at 64mb makes every later write fail with OOM. Re-apply the stack's defaults.
    if (/CONFIG\s+SET/i.test(readFileSync(file, 'utf8'))) {
      await cli('CONFIG SET maxmemory 536870912');
      await cli('CONFIG SET maxmemory-policy noeviction');
      log(
        `      reset maxmemory 536870912 and maxmemory-policy noeviction after ${label} (it contains CONFIG SET)`,
      );
    }
    // A solution that wiped Redis leaves the game's own mirror missing: put it back before the next one.
    if (wipes(transcript)) await api('POST', '/api/progress/restore');
  }
  await restoreWorkspace();
  await api('POST', `/api/levels/${id}/complete`);
}

// ---- progress from the WebSocket ------------------------------------------------------------------

let busySince = 0;
let ticker = null;
// Everything that wants the engine's verify_* progress events as they arrive (E-01: the channel_message rule).
const progressListeners = new Set();
function watchProgress() {
  try {
    const ws = new WebSocket(`${opts.engine.replace(/^http/, 'ws')}/ws`);
    ws.onmessage = (m) => {
      let e;
      try {
        e = JSON.parse(m.data);
      } catch {
        return;
      }
      if (e.type !== 'level.event' || !String(e.data?.name ?? '').startsWith('verify_')) return;
      const d = e.data.data ?? {};
      for (const fn of progressListeners) {
        try {
          fn(e.data.name, d);
        } catch {
          // a listener must not stop the progress lines
        }
      }
      switch (e.data.name) {
        case 'verify_started':
          busySince = Date.now();
          break;
        case 'verify_check_started':
          if (d.type === 'traffic' || d.type === 'behavior')
            log(`      ... ${d.levelId} check #${d.index} ${d.type} running`);
          break;
        case 'verify_traffic_phase':
          log(
            `      ... load ${d.phase} for ${d.scenario} (slots on: ${(d.activeSlots ?? []).join(', ') || 'none'})`,
          );
          break;
        case 'verify_finished':
          busySince = 0;
          break;
        default:
      }
    };
    ws.onerror = () => undefined;
  } catch {
    // progress lines are a convenience
  }
  ticker = setInterval(() => {
    if (busySince && Date.now() - busySince > 15_000)
      log(`      ... still verifying (${Math.round((Date.now() - busySince) / 1000)} s)`);
  }, 15_000);
}

// ---- table ----------------------------------------------------------------------------------------

function printTable() {
  const shortLevel = (l) =>
    l.replace(/^(ch\d+[a-z]?-\d+|example-[a-z]+-\d+)-.*/, '$1').replace(/^example-/, 'ex-');
  const cols = [
    ['LEVEL', (r) => shortLevel(r.level)],
    ['SOLUTION', (r) => r.solution.replace(/^solutions\//, '')],
    ['DECLARED', (r) => r.declared],
    ['ENGINE', (r) => r.engine],
    ['RESULT', (r) => r.result],
  ];
  const w = cols.map(([h, f]) => Math.min(60, Math.max(h.length, ...rows.map((r) => f(r).length))));
  const fmt = (cells) => cells.map((c, i) => c.slice(0, w[i]).padEnd(w[i])).join('  ');
  console.log(`\n${fmt(cols.map(([h]) => h))}`);
  console.log(fmt(w.map((n) => '-'.repeat(n))));
  for (const r of rows)
    console.log(fmt(cols.map(([, f]) => f(r))) + (r.result === 'SKIPPED' ? `  ${r.note}` : ''));

  const per = new Map();
  for (const r of rows) {
    const c = per.get(r.chapter) ?? { PASS: 0, MISMATCH: 0, SKIPPED: 0 };
    c[r.result] += 1;
    per.set(r.chapter, c);
  }
  console.log('');
  for (const [ch, c] of per)
    console.log(`${ch.padEnd(24)} PASS ${c.PASS}  MISMATCH ${c.MISMATCH}  SKIPPED ${c.SKIPPED}`);
  const bad = rows.filter((r) => r.result === 'MISMATCH');
  if (bad.length) {
    console.log(`\n${bad.length} MISMATCH:`);
    for (const r of bad) {
      console.log(`  ${r.level}  ${r.solution}: declared ${r.declared}, engine ${r.engine}`);
      if (r.because) console.log(`      declared because: ${r.because}`);
      if (r.note) console.log(`      note: ${r.note}`);
      for (const f of r.feedback)
        console.log(
          `      [${f.tag}] #${f.index} ${f.type}: ${f.message.split('\n').join('\n          ')}`,
        );
    }
  }
}

// ---- main -----------------------------------------------------------------------------------------

try {
  await resolveTargets();
  await loadSlotFiles();
  await ensurePlayer();
  watchProgress();
  for (const { lc, only } of chapters) {
    log(`#### chapter ${lc.id} (${basename(lc.dir)})`);
    for (const lv of lc.levels) if (!only || only.has(lv.level.id)) await gradeLevel(lv);
  }
} catch (e) {
  console.error(`\ngrade: ${e.stack ?? e}`);
  if (ticker) clearInterval(ticker);
  await restoreWorkspace().catch(() => undefined);
  process.exit(2);
}
if (ticker) clearInterval(ticker);
printTable();
if (opts.json) {
  const per = {};
  for (const r of rows) {
    per[r.chapter] ??= { PASS: 0, MISMATCH: 0, SKIPPED: 0 };
    per[r.chapter][r.result] += 1;
  }
  writeFileSync(
    opts.json,
    `${JSON.stringify({ engine: opts.engine, at: new Date().toISOString(), summary: per, rows }, null, 2)}\n`,
  );
}
process.exit(rows.some((r) => r.result === 'MISMATCH') ? 1 : 0);
