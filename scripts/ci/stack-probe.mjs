#!/usr/bin/env node
// Probes a compose stack from the outside, through the proxy, the way a browser reaches it.
// .github/workflows/stack.yml runs it on a hosted arm64 runner against a stack it has just built.
//
// It also runs on a Mac, but only against an ISOLATED stack (scripts/check/lib/isolate.sh), never the default
// project: the `up` mode reads /api/league, and scoring the league empties logical database 7 of the target
// Redis. That is the league's own design, and not something to point at a save by accident.
//
//   node scripts/ci/stack-probe.mjs start-page <base>   the proxy is up and nothing else is
//   node scripts/ci/stack-probe.mjs up <base>           the whole stack is up

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

function parse(r) {
  try {
    return JSON.parse(r.text);
  } catch {
    return undefined;
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

  const stage = await request('/_starting/stage.json');
  const stageJson = parse(stage);
  if (stage.status === 200 && stageJson && typeof stageJson.stage === 'string')
    ok(`GET /_starting/stage.json: 200, stage "${stageJson.stage}"`);
  else
    bad(
      `GET /_starting/stage.json: expected the stage file, got ${stage.status} ${stage.text.slice(0, 120)}`,
    );
  const stageCache = stage.headers.get('cache-control') ?? '';
  if (stageCache.includes('no-store')) ok('the stage file is sent with Cache-Control: no-store');
  else bad(`the stage file has Cache-Control "${stageCache}", expected no-store`);
}

// ---------------------------------------------------------------------------------------------------------
// The whole stack.

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

const JSON_ROUTES = [
  '/health',
  '/api/chapters',
  '/api/progress',
  '/api/community',
  '/api/coverage',
  '/api/credits',
  '/api/league',
  '/api/matchday/status',
  '/app/health',
  '/app/slots',
];

async function up() {
  for (const p of PAGES) {
    const r = await request(p);
    if (r.status === 200 && /<html/i.test(r.text) && !isStartPage(r)) ok(`page ${p}: 200`);
    else
      bad(
        `page ${p}: ${r.status} (${r.text.length} chars)${isStartPage(r) ? ', the start page' : ''}`,
      );
  }

  for (const p of JSON_ROUTES) {
    const r = await request(p);
    const json = parse(r);
    if (r.status === 200 && json !== undefined) {
      ok(`GET ${p}: 200 JSON`);
      note(shape(json).slice(0, 1200));
    } else {
      bad(`GET ${p}: ${r.status}`);
      note(r.text.slice(0, 300));
    }
  }

  // The phone's request trace (D-04): only when asked for.
  const traced = await request('/app/players/p-028/stats', { headers: { 'x-quest-trace': '1' } });
  const trace = traced.headers.get('x-quest-trace');
  if (traced.status === 200 && trace) {
    ok(`traced request: 200 with an x-quest-trace header (${trace.length} chars)`);
    note(trace.slice(0, 400));
  } else bad(`traced request: ${traced.status}, x-quest-trace ${trace ? 'present' : 'missing'}`);
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
