#!/usr/bin/env node
// scripts/ci/stack.mjs (D-01): the game's backend as plain processes, for CI and for a quick look without Docker.
//
//   REDIS_URL=redis://127.0.0.1:6379 DATABASE_URL=postgres://quest:quest@127.0.0.1:5432/quest \
//     node scripts/ci/stack.mjs
//
// It starts the built engine, app and runner (engine/dist, app/dist, runner/dist: run `pnpm -r build` or at least
// `pnpm --filter @quest/engine... --filter @quest/app... --filter @quest/runner... build` first) against the Redis
// and Postgres you name, and puts ONE origin in front of them the way docker/Caddyfile does: `/app/*` goes to the
// app; `/api/*`, `/health`, `/ws` (WebSocket upgrade included) and `/internal/*` go to the engine. The ui service is
// not started (it needs a Next.js build and nothing the grader does goes through it), so any other path answers 404.
// When /health says Redis and Postgres are up and the levels loaded, it prints `STACK_ORIGIN=<origin>` and
// `stack ready`, then runs until SIGTERM or SIGINT, which stops everything. Exit codes: 0 after a signal, 1 when a
// service died or the stack did not become ready in time, 2 when it could not be started (bad environment).
//
// It never talks to Docker and never touches the default compose project. It does change the Redis it is given:
// ENGINE_DEV is on, and the five server settings of docker-compose.yml's Redis are applied (see stack-lib.mjs), so
// point it at a Redis you can afford to change. Postgres must already have the schema and seed loaded.
//
// Environment (everything but the first two is optional):
//   REDIS_URL, DATABASE_URL   required
//   STACK_PORT                the origin's port (default 3000), always on 127.0.0.1
//   STACK_ENGINE_PORT / STACK_APP_PORT / STACK_RUNNER_PORT   default 4200 / 4000 / 4100
//   STACK_DIR                 where logs, progress and a copy of workspace/ go (default: a new temp directory)
//   STACK_KEEP=1              do not delete a temp directory this script created
//   STACK_READY_TIMEOUT_S     how long to wait for /health (default 120)
//   STACK_ORIGIN_FILE         also write the origin to this file
// Node 22, no dependencies. Everything the services print goes to this process's stdout, one prefixed line each.
/* global process, console, setTimeout, clearTimeout, setInterval, Buffer */
import { spawn } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  REDIS_DEFAULTS,
  encodeCommand,
  healthIsReady,
  portOf,
  redactUrl,
  routeFor,
} from './stack-lib.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const HOST = '127.0.0.1';
const t0 = Date.now();
const log = (m) =>
  console.log(`[stack ${String(Math.floor((Date.now() - t0) / 1000)).padStart(3)}s] ${m}`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function die(code, message) {
  console.error(`[stack] ${message}`);
  process.exit(code);
}

// ---- environment ----------------------------------------------------------------------------------

const redisUrl = process.env.REDIS_URL;
const databaseUrl = process.env.DATABASE_URL;
if (!redisUrl) die(2, 'REDIS_URL is not set (for example redis://127.0.0.1:6379)');
if (!databaseUrl)
  die(2, 'DATABASE_URL is not set (for example postgres://quest:quest@127.0.0.1:5432/quest)');
const portEnv = (name, dflt) => {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return dflt;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1 || n > 65535) die(2, `${name}=${raw} is not a port number`);
  return n;
};
const ports = {
  proxy: portEnv('STACK_PORT', 3000),
  engine: portEnv('STACK_ENGINE_PORT', 4200),
  app: portEnv('STACK_APP_PORT', 4000),
  runner: portEnv('STACK_RUNNER_PORT', 4100),
};
const origin = `http://${HOST}:${ports.proxy}`;
const readyTimeoutMs = Number(process.env.STACK_READY_TIMEOUT_S ?? 120) * 1000;

const entries = {
  engine: 'engine/dist/main.js',
  app: 'app/dist/main.js',
  runner: 'runner/dist/main.js',
};
for (const [name, rel] of Object.entries(entries)) {
  if (!existsSync(join(ROOT, rel)))
    die(2, `${rel} is missing: build first (pnpm -r build). ${name} cannot start without it.`);
}
if (!existsSync(join(ROOT, 'packages/shared/dist/index.js')))
  die(2, 'packages/shared/dist is missing: build first (pnpm --filter @quest/shared build).');

// ---- working directories --------------------------------------------------------------------------

const ownsDir = !process.env.STACK_DIR;
const dir = process.env.STACK_DIR
  ? resolve(process.env.STACK_DIR)
  : mkdtempSync(join(tmpdir(), 'quest-stack-'));
const logDir = join(dir, 'logs');
const progressDir = join(dir, 'progress');
const workspaceDir = join(dir, 'workspace');
for (const d of [logDir, progressDir, workspaceDir]) mkdirSync(d, { recursive: true });
// The grader and the learner write into the workspace: give the stack a copy, never the checkout's own folder.
if (existsSync(join(ROOT, 'workspace')))
  cpSync(join(ROOT, 'workspace'), workspaceDir, { recursive: true });

log(`node ${process.version}, repo ${ROOT}`);
log(`directory ${dir} (logs, progress, workspace copy)`);
log(`REDIS_URL ${redactUrl(redisUrl)}`);
log(`DATABASE_URL ${redactUrl(databaseUrl)}`);
log(
  `ports: origin ${ports.proxy}, engine ${ports.engine}, app ${ports.app}, runner ${ports.runner}`,
);

// ---- Redis settings -------------------------------------------------------------------------------

/** Sends commands over one raw connection and returns each first reply line. A failure is logged, never fatal. */
async function applyRedisDefaults() {
  let u;
  try {
    u = new URL(redisUrl);
  } catch {
    log('REDIS_URL is not a URL; skipping the Redis settings');
    return;
  }
  const commands = [];
  if (u.password)
    commands.push(
      u.username
        ? ['AUTH', decodeURIComponent(u.username), decodeURIComponent(u.password)]
        : ['AUTH', decodeURIComponent(u.password)],
    );
  commands.push(...REDIS_DEFAULTS);
  await new Promise((done) => {
    const sock = net.connect({ host: u.hostname || HOST, port: Number(portOf(redisUrl, 6379)) });
    let buf = '';
    let i = 0;
    const timer = setTimeout(() => {
      log(`redis settings: no answer within 10 s (sent ${i} of ${commands.length}); continuing`);
      sock.destroy();
      done();
    }, 10_000);
    const finish = () => {
      clearTimeout(timer);
      sock.destroy();
      done();
    };
    const sendNext = () => {
      if (i >= commands.length) return finish();
      sock.write(encodeCommand(commands[i]));
    };
    sock.on('connect', sendNext);
    sock.on('data', (d) => {
      buf += d.toString('utf8');
      let nl;
      // Every command here answers with one simple line (+OK or -ERR ...).
      while ((nl = buf.indexOf('\r\n')) !== -1 && i < commands.length) {
        const line = buf.slice(0, nl);
        buf = buf.slice(nl + 2);
        const shown = commands[i][0] === 'AUTH' ? 'AUTH ***' : commands[i].join(' ');
        log(`redis: ${shown} -> ${line}`);
        i += 1;
        sendNext();
      }
    });
    sock.on('error', (e) => {
      log(`redis settings: ${e.message}; continuing`);
      finish();
    });
  });
}

// ---- child processes ------------------------------------------------------------------------------

const children = new Map(); // name -> ChildProcess
let stopping = false;

function prefixLines(name, stream) {
  let rest = '';
  stream.on('data', (d) => {
    rest += d.toString('utf8');
    let nl;
    while ((nl = rest.indexOf('\n')) !== -1) {
      console.log(`[${name}] ${rest.slice(0, nl)}`);
      rest = rest.slice(nl + 1);
    }
  });
  stream.on('end', () => {
    if (rest) console.log(`[${name}] ${rest}`);
  });
}

function startService(name, env) {
  const child = spawn(process.execPath, [join(ROOT, entries[name])], {
    cwd: ROOT,
    env: { ...process.env, NODE_ENV: 'production', ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  children.set(name, child);
  prefixLines(name, child.stdout);
  prefixLines(`${name}!`, child.stderr);
  child.on('exit', (code, signal) => {
    log(`${name} exited (code ${code}, signal ${signal})`);
    if (!stopping) void shutdown(1, `${name} stopped by itself; see its lines above`);
  });
  child.on('error', (e) => {
    log(`${name} could not start: ${e.message}`);
    if (!stopping) void shutdown(1, `${name} did not start`);
  });
  log(`started ${name} (pid ${child.pid})`);
}

const common = {
  REDIS_URL: redisUrl,
  DATABASE_URL: databaseUrl,
  LOG_DIR: logDir,
  WORKSPACE_DIR: workspaceDir,
};

// ---- the single origin ----------------------------------------------------------------------------

const upstream = (kind) => ports[kind];

const proxy = http.createServer((req, res) => {
  const kind = routeFor(req.url ?? '/');
  if (!kind) {
    res.writeHead(404, { 'content-type': 'application/json' });
    res.end(
      JSON.stringify({
        error: 'not_found',
        message: 'this stack serves /app, /api, /health, /ws and /internal only (no ui)',
      }),
    );
    return;
  }
  const up = http.request(
    {
      host: HOST,
      port: upstream(kind),
      method: req.method,
      path: req.url,
      headers: req.headers,
      agent: false,
    },
    (ur) => {
      res.writeHead(ur.statusCode ?? 502, ur.headers);
      ur.pipe(res);
    },
  );
  up.on('error', (e) => {
    if (res.headersSent) return res.destroy();
    res.writeHead(502, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: 'bad_gateway', upstream: kind, message: e.message }));
  });
  req.pipe(up);
});
// Verification and load runs can take minutes: the proxy must not cut a request off.
proxy.requestTimeout = 0;
proxy.timeout = 0;
proxy.headersTimeout = 0;

// WebSocket upgrade: replay the request head to the engine, then copy bytes both ways.
proxy.on('upgrade', (req, socket, head) => {
  if (routeFor(req.url ?? '/') !== 'engine') {
    socket.end('HTTP/1.1 404 Not Found\r\nConnection: close\r\nContent-Length: 0\r\n\r\n');
    return;
  }
  const up = net.connect(ports.engine, HOST, () => {
    let raw = `${req.method} ${req.url} HTTP/${req.httpVersion}\r\n`;
    for (let k = 0; k < req.rawHeaders.length; k += 2)
      raw += `${req.rawHeaders[k]}: ${req.rawHeaders[k + 1]}\r\n`;
    up.write(`${raw}\r\n`);
    if (head && head.length) up.write(head);
    socket.pipe(up);
    up.pipe(socket);
  });
  up.on('error', () => socket.destroy());
  socket.on('error', () => up.destroy());
  up.on('close', () => socket.destroy());
  socket.on('close', () => up.destroy());
});

// ---- readiness ------------------------------------------------------------------------------------

function getText(url, timeoutMs = 2000) {
  return new Promise((done) => {
    const req = http.get(url, { agent: false, timeout: timeoutMs }, (res) => {
      let body = '';
      res.on('data', (d) => (body += d));
      res.on('end', () => done({ status: res.statusCode, body }));
    });
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.on('error', (e) => done({ status: 0, body: e.message }));
  });
}

async function waitReady() {
  const end = Date.now() + readyTimeoutMs;
  let lastShown = 0;
  let last = 'no answer yet';
  while (Date.now() < end && !stopping) {
    const h = await getText(`${origin}/health`);
    last = `GET /health -> ${h.status} ${h.body.slice(0, 300)}`;
    if (h.status === 200 && healthIsReady(h.body)) {
      const a = await getText(`${origin}/app/health`);
      last = `GET /app/health -> ${a.status} ${a.body.slice(0, 300)}`;
      if (a.status === 200 && a.body.includes('"service":"app"')) return { ok: true, last };
    }
    if (Date.now() - lastShown >= 5000) {
      log(`waiting: ${last}`);
      lastShown = Date.now();
    }
    await sleep(1000);
  }
  return { ok: false, last };
}

// ---- shutdown -------------------------------------------------------------------------------------

async function shutdown(code, why) {
  if (stopping) return;
  stopping = true;
  log(`stopping (${why})`);
  proxy.close();
  proxy.closeAllConnections?.();
  for (const [name, c] of children) {
    if (c.exitCode === null && c.signalCode === null) {
      log(`SIGTERM ${name}`);
      c.kill('SIGTERM');
    }
  }
  const end = Date.now() + 10_000;
  while (
    Date.now() < end &&
    [...children.values()].some((c) => c.exitCode === null && c.signalCode === null)
  )
    await sleep(200);
  for (const [name, c] of children) {
    if (c.exitCode === null && c.signalCode === null) {
      log(`SIGKILL ${name} (did not stop in 10 s)`);
      c.kill('SIGKILL');
    }
  }
  if (ownsDir && process.env.STACK_KEEP !== '1') {
    rmSync(dir, { recursive: true, force: true });
    log(`removed ${dir}`);
  } else {
    log(`kept ${dir}`);
  }
  process.exit(code);
}
process.on('SIGTERM', () => void shutdown(0, 'SIGTERM'));
process.on('SIGINT', () => void shutdown(0, 'SIGINT'));
process.on('uncaughtException', (e) => {
  console.error(e);
  void shutdown(1, `uncaught exception: ${e.message}`);
});

// ---- go -------------------------------------------------------------------------------------------

await applyRedisDefaults();

// The levels' text may read host ports with {{env.NAME}}; give them the ports this stack really uses.
const templatePorts = {
  REDIS_PORT: portOf(redisUrl, 6379),
  PG_PORT: portOf(databaseUrl, 5432),
  PROXY_PORT: String(ports.proxy),
  INSIGHT_PORT: '5540',
};
startService('runner', { ...common, PORT: String(ports.runner) });
startService('app', {
  ...common,
  PORT: String(ports.app),
  ENGINE_URL: `http://${HOST}:${ports.engine}`,
  APP_INSTANCE: 'app-1',
  // As in docker-compose.yml: the proxy balances per request itself, so keep-alive stays on.
  APP_MAX_REQUESTS_PER_SOCKET: '0',
});
startService('engine', {
  ...common,
  ...templatePorts,
  PORT: String(ports.engine),
  PROGRESS_DIR: progressDir,
  LEVELS_DIR: join(ROOT, 'levels'),
  SCENARIOS_DIR: join(ROOT, 'scenarios'),
  ENGINE_DEV: '1', // the grader unlocks levels through POST /api/levels/:id/complete
  APP_URL: `${origin}/app`,
  RUNNER_URL: `http://${HOST}:${ports.runner}`,
});

await new Promise((done, fail) => {
  proxy.once('error', fail);
  proxy.listen(ports.proxy, HOST, done);
}).catch((e) => void shutdown(1, `could not listen on ${origin}: ${e.message}`));
log(`proxy listening on ${origin}`);

const ready = await waitReady();
if (!ready.ok) {
  console.error(
    `[stack] not ready after ${Math.round(readyTimeoutMs / 1000)} s. Last answer: ${ready.last}`,
  );
  console.error(
    '[stack] the lines above (prefixed [engine], [app], [runner]; [name!] is stderr) say why.',
  );
  await shutdown(1, 'not ready in time');
}
if (process.env.STACK_ORIGIN_FILE) writeFileSync(process.env.STACK_ORIGIN_FILE, `${origin}\n`);
console.log(`STACK_ORIGIN=${origin}`);
log(`stack ready: ${ready.last}`);
// Keep a timer so the event loop stays alive even if every handle above is idle.
setInterval(() => undefined, 60_000);
