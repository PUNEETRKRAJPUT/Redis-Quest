#!/usr/bin/env node
// Probes a compose stack from the outside, through the proxy, the way a browser reaches it.
// .github/workflows/stack.yml runs it on a hosted arm64 runner against a stack it has just built.
//
// It also runs on a Mac, but only against an ISOLATED, FRESH stack (scripts/check/lib/isolate.sh), never the
// default project: the `up` mode creates a player, and it reads /api/league, which makes the engine empty logical
// database 7 of the target Redis. That is the league's own design, and not something to point at a save.
//
//   node scripts/ci/stack-probe.mjs start-page <base>   the proxy is up and nothing else is
//   node scripts/ci/stack-probe.mjs up <base>           the whole stack is up, on a fresh game

const [mode, baseArg] = process.argv.slice(2);
if (!mode || !baseArg) {
  console.log('usage: stack-probe.mjs start-page|up <base url, for example http://127.0.0.1:3000>');
  process.exit(2);
}
const base = baseArg.replace(/\/$/, '');

let fails = 0;
const ok = (m) => console.log(`ok    ${m}`);
const bad = (m) => {
  fails++;
  console.log(`FAIL  ${m}`);
};
const note = (m) => console.log(`      ${m}`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** One request. A network failure is status 0 with the error as the body, so a probe never throws. */
async function request(path, init = {}) {
  try {
    const res = await fetch(base + path, {
      redirect: 'manual',
      signal: AbortSignal.timeout(30_000),
      ...init,
    });
    return { status: res.status, text: await res.text(), headers: res.headers };
  } catch (e) {
    return { status: 0, text: String(e?.cause ?? e), headers: new Headers() };
  }
}

function parse(r) {
  try {
    return JSON.parse(r.text);
  } catch {
    return undefined;
  }
}

async function getJson(path, init) {
  const r = await request(path, init);
  return { ...r, json: parse(r) };
}

const postJson = (path, body) =>
  getJson(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });

const START_PAGE_TITLE = 'Redis Quest is starting';
const isStartPage = (r) => r.text.includes(START_PAGE_TITLE);

/** A short description of a JSON value: enough to read a route's answer in a log line. */
function shape(v, depth = 0) {
  if (Array.isArray(v)) {
    return `array(${v.length})${depth < 2 && v.length > 0 ? ` of ${shape(v[0], depth + 1)}` : ''}`;
  }
  if (v !== null && typeof v === 'object') {
    if (depth >= 2) return 'object';
    return `{${Object.entries(v)
      .map(([k, x]) => `${k}: ${shape(x, depth + 1)}`)
      .join(', ')}}`;
  }
  const s = JSON.stringify(v);
  return s.length > 60 ? `${s.slice(0, 57)}..."` : s;
}

/** Polls until `done(answer)` is true. Returns the seconds it took, or -1 after `limitS`. */
async function waitFor(path, done, limitS) {
  const start = Date.now();
  for (;;) {
    const r = await getJson(path);
    if (r.status === 200 && r.json !== undefined && done(r.json))
      return Math.round((Date.now() - start) / 1000);
    if (Date.now() - start > limitS * 1000) return -1;
    await sleep(2000);
  }
}

// ---------------------------------------------------------------------------------------------------------
// The proxy alone: every page request gets the start page WITH the error's status, everything else a bare error.

async function startPage() {
  for (const p of ['/', '/level/ch0-01', '/league', '/no/such/page']) {
    const r = await request(p);
    if (r.status === 502 && isStartPage(r)) ok(`GET ${p}: 502 with the start page`);
    else
      bad(`GET ${p}: expected 502 with the start page, got ${r.status} (${r.text.length} chars)`);
  }
  const root = await request('/');
  const cache = root.headers.get('cache-control') ?? '';
  if (cache.includes('no-store')) ok('the start page is sent with Cache-Control: no-store');
  else bad(`the start page has Cache-Control "${cache}", expected no-store`);

  // The engine's paths and the assets must stay bare errors: a script that polls /health must never read a page.
  for (const p of [
    '/api/chapters',
    '/health',
    '/internal/app-config',
    '/_next/static/chunks/none.js',
  ]) {
    const r = await request(p);
    if (r.status === 502 && !isStartPage(r)) ok(`GET ${p}: bare 502 (${r.text.length} chars)`);
    else bad(`GET ${p}: expected a bare 502, got ${r.status} (${r.text.length} chars)`);
  }
  // /app/* is looked up by name on every request, and nothing answers to that name yet.
  const app = await request('/app/health');
  if (app.status >= 500 && !isStartPage(app)) ok(`GET /app/health: bare ${app.status}`);
  else bad(`GET /app/health: expected a bare 5xx, got ${app.status} (${app.text.length} chars)`);

  const stage = await getJson('/_starting/stage.json');
  if (stage.status === 200 && typeof stage.json?.stage === 'string')
    ok(`GET /_starting/stage.json: 200, stage "${stage.json.stage}"`);
  else
    bad(
      `GET /_starting/stage.json: expected the stage file, got ${stage.status} ${stage.text.slice(0, 120)}`,
    );
  const stageCache = stage.headers.get('cache-control') ?? '';
  if (stageCache.includes('no-store')) ok('the stage file is sent with Cache-Control: no-store');
  else bad(`the stage file has Cache-Control "${stageCache}", expected no-store`);
}

// ---------------------------------------------------------------------------------------------------------
// The whole stack, on a fresh game.

const PAGES = [
  '/',
  '/arcade',
  '/built',
  '/community',
  '/credits',
  '/design',
  '/editor',
  '/league',
  '/logs',
  '/matchday',
  '/metrics',
  '/phone',
  '/showme',
  '/studio',
  '/terminal',
  '/your-turn',
];

/** Every object anywhere in `v` that has an array under `key`. */
function countWith(v, key) {
  if (Array.isArray(v)) return v.reduce((n, x) => n + countWith(x, key), 0);
  if (v === null || typeof v !== 'object') return 0;
  return (
    (Array.isArray(v[key]) ? 1 : 0) + Object.values(v).reduce((n, x) => n + countWith(x, key), 0)
  );
}

async function up() {
  // A first start loads the seed into Postgres, which takes longer than the containers take to report healthy:
  // until it is done the engine says postgres "down" and the app's database routes answer 500.
  const pg = await waitFor('/health', (h) => h.postgres === 'up' && h.redis === 'up', 300);
  if (pg >= 0) ok(`the engine sees Redis and Postgres (after ${pg} s of waiting here)`);
  else bad('the engine never reported redis and postgres up within 300 s');
  const appUp = await waitFor('/app/health', (h) => h.engine === 'up' && h.redis === 'up', 120);
  if (appUp >= 0) ok(`the app sees Redis and the engine (after ${appUp} s of waiting here)`);
  else bad('the app never reported redis and the engine up within 120 s');
  for (const p of ['/health', '/app/health']) note(`${p}: ${shape((await getJson(p)).json)}`);

  for (const p of PAGES) {
    const r = await request(p);
    if (r.status === 200 && /<html/i.test(r.text) && !isStartPage(r)) ok(`page ${p}: 200`);
    else
      bad(
        `page ${p}: ${r.status} (${r.text.length} chars)${isStartPage(r) ? ', the start page' : ''}`,
      );
  }

  // The campaign, as the map reads it.
  const chapters = await getJson('/api/chapters');
  const list = chapters.json?.chapters ?? [];
  const levels = list.reduce((n, c) => n + (Array.isArray(c.levels) ? c.levels.length : 0), 0);
  if (chapters.status === 200 && list.length === 8 && levels === 96)
    ok('GET /api/chapters: 8 chapters, 96 levels');
  else
    bad(
      `GET /api/chapters: ${chapters.status}, ${list.length} chapters, ${levels} levels (want 8 and 96)`,
    );
  note(`first chapter: ${shape(list[0]).slice(0, 700)}`);
  const choices = countWith(list, 'choices');
  if (choices > 0) ok(`reply choices (D-02): ${choices} of the player's lines carry choices`);
  else bad('reply choices (D-02): no message in /api/chapters carries choices');

  // A fresh game has no player; then it has one.
  const fresh = await getJson('/api/progress');
  if (fresh.status === 404 && fresh.json?.error === 'no_player')
    ok('GET /api/progress on a fresh game: 404 no_player');
  else bad(`GET /api/progress on a fresh game: ${fresh.status} ${fresh.text.slice(0, 160)}`);
  const player = await postJson('/api/player', { name: 'Stack Probe' });
  if (player.status >= 200 && player.status < 300) ok(`POST /api/player: ${player.status}`);
  else bad(`POST /api/player: ${player.status} ${player.text.slice(0, 200)}`);
  const progress = await getJson('/api/progress');
  if (progress.status === 200 && progress.json) {
    ok('GET /api/progress after that: 200');
    note(shape(progress.json).slice(0, 500));
  } else
    bad(
      `GET /api/progress after creating a player: ${progress.status} ${progress.text.slice(0, 160)}`,
    );

  // Community levels (D-05).
  const community = await getJson('/api/community');
  if (
    community.status === 200 &&
    community.json?.levelCount >= 1 &&
    community.json?.errorCount === 0
  )
    ok(
      `GET /api/community: ${community.json.packs.length} pack(s), ${community.json.levelCount} level(s), no errors`,
    );
  else bad(`GET /api/community: ${community.status} ${community.text.slice(0, 300)}`);
  note(shape(community.json).slice(0, 700));

  // The wanted-commands board and the credits (D-06).
  const coverage = await getJson('/api/coverage');
  const c = coverage.json;
  if (coverage.status === 200 && c?.available === true) {
    const adds = c.commands + c.skipped.subcommands + c.skipped.modules === c.listed;
    const split = c.taught + c.untaught === c.commands;
    if (adds && split)
      ok(
        `GET /api/coverage: ${c.listed} listed = ${c.commands} on the board + ${c.skipped.subcommands} subcommands + ${c.skipped.modules} module commands; ${c.taught} taught, ${c.untaught} not`,
      );
    else bad(`GET /api/coverage: the numbers do not add up: ${shape({ ...c, groups: undefined })}`);
    const taught = (c.groups ?? []).flatMap((g) =>
      g.commands.filter((x) => x.taught).map((x) => `${x.name}<${x.usedBy?.[0]?.levelId ?? '?'}`),
    );
    note(`levels read: ${c.levelsRead}; taught commands and one level each:`);
    for (let i = 0; i < taught.length; i += 6) note(`  ${taught.slice(i, i + 6).join('  ')}`);
  } else bad(`GET /api/coverage: ${coverage.status} ${coverage.text.slice(0, 300)}`);
  const credits = await getJson('/api/credits');
  if (
    credits.status === 200 &&
    credits.json?.cast?.length > 0 &&
    Array.isArray(credits.json?.contributors)
  )
    ok(
      `GET /api/credits: ${credits.json.cast.length} in the cast, ${credits.json.contributors.length} contributor line(s)`,
    );
  else bad(`GET /api/credits: ${credits.status} ${credits.text.slice(0, 300)}`);

  // The Economy League (D-07): the committed entries scored against this Redis. Every house entry must meet par.
  const league = await getJson('/api/league');
  const l = league.json;
  if (
    league.status === 200 &&
    l?.scored === true &&
    (l.problems ?? []).length === 0 &&
    l.holes?.length > 0
  ) {
    ok(`GET /api/league: ${l.holes.length} holes scored on database ${l.db}, no problems`);
    for (const h of l.holes) {
      const rows = (h.entries ?? []).map(
        (e) => `${e.handle} rank ${e.rank} (${e.commands} commands, ${e.underPar} under par)`,
      );
      const house = (h.entries ?? []).find((e) => e.handle === 'par-house');
      if (house && house.underPar === 0)
        ok(`hole ${h.id}: par ${h.par}; the house entry meets par`);
      else
        bad(
          `hole ${h.id}: par ${h.par}; the house entry is ${house ? `${house.underPar} under par` : 'missing or did not score'}`,
        );
      note(rows.join('; ') || shape(h).slice(0, 400));
    }
  } else {
    bad(
      `GET /api/league: ${league.status} scored=${l?.scored} problems=${JSON.stringify(l?.problems ?? null).slice(0, 400)}`,
    );
    note(league.text.slice(0, 600));
  }
  const attempt = await postJson('/api/league/score', {
    hole: l?.holes?.[0]?.id,
    entry: 'MSET kit:bat 12 kit:ball 30 kit:pads 8 kit:gloves 10 kit:helmet 6',
  });
  if (attempt.status === 200 && attempt.json?.result?.ok === true)
    ok(
      `POST /api/league/score on ${l?.holes?.[0]?.id}: ${attempt.json.result.commands} command(s), ${attempt.json.result.underPar} under par, rank ${shape(attempt.json.rank)}`,
    );
  else bad(`POST /api/league/score: ${attempt.status} ${attempt.text.slice(0, 400)}`);

  // Match Day (D-09) at rest. Playing one is scripts/check/D-09.sh, on a stack of its own.
  const match = await getJson('/api/matchday/status');
  if (match.status === 200 && match.json?.state === 'idle') ok('GET /api/matchday/status: idle');
  else bad(`GET /api/matchday/status: ${match.status} ${match.text.slice(0, 200)}`);

  // The phone's request trace (D-04): only when asked for.
  const traced = await request('/app/players/p-028/stats', { headers: { 'x-quest-trace': '1' } });
  const trace = traced.headers.get('x-quest-trace');
  if (traced.status === 200 && trace) {
    ok(`traced request: 200 with an x-quest-trace header (${trace.length} chars)`);
    note(trace.slice(0, 400));
  } else
    bad(
      `traced request: ${traced.status}, x-quest-trace ${trace ? 'present' : 'missing'}: ${traced.text.slice(0, 200)}`,
    );
  const plain = await request('/app/players/p-028/stats');
  if (plain.status === 200 && !plain.headers.get('x-quest-trace'))
    ok('the same request without the header carries no trace');
  else
    bad(
      `untraced request: ${plain.status}, x-quest-trace present: ${Boolean(plain.headers.get('x-quest-trace'))}`,
    );
}

const modes = { 'start-page': startPage, up };
if (!modes[mode]) {
  console.log(`unknown mode "${mode}"`);
  process.exit(2);
}
await modes[mode]();
console.log(fails === 0 ? `stack-probe ${mode}: OK` : `stack-probe ${mode}: ${fails} FAILED`);
process.exit(fails === 0 ? 0 : 1);
