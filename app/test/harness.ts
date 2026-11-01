// Test harness: a stub engine (the P0-06 /internal contracts) and the real built app in a child process.
// The app runs under plain node, not vitest, because vitest's module runner ignores the ?v= cache-busting
// query that hot reload depends on (see docs/handoffs/P0-08.md).
import { spawn, type ChildProcess } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import { createServer as createNetServer } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const APP_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const FIXTURES = path.join(APP_DIR, 'test', 'fixtures');
const REPO = path.resolve(APP_DIR, '..');

/** Host ports of the redis and postgres the tests use: the check's quest-p07 project (.env.p07). */
function envFilePort(name: string, dflt: number): number {
  if (process.env[name]) return Number(process.env[name]);
  const file = path.join(REPO, '.env.p07');
  if (existsSync(file)) {
    const m = readFileSync(file, 'utf8').match(new RegExp(`^${name}=(\\d+)`, 'm'));
    if (m) return Number(m[1]);
  }
  return dflt;
}
// Explicit URLs win (CI sets them for its service containers); otherwise the quest-p07 ports.
export const REDIS_URL = process.env.REDIS_URL ?? `redis://127.0.0.1:${envFilePort('REDIS_PORT', 6391)}`;
export const DATABASE_URL =
  process.env.DATABASE_URL ?? `postgres://quest:quest@127.0.0.1:${envFilePort('PG_PORT', 5433)}/quest`;

export function tempDir(prefix: string): string {
  return mkdtempSync(path.join(tmpdir(), `quest-p07-${prefix}-`));
}

export async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const s = createNetServer();
    s.once('error', reject);
    s.listen(0, '127.0.0.1', () => {
      const addr = s.address();
      const port = typeof addr === 'object' && addr ? addr.port : 0;
      s.close(() => resolve(port));
    });
  });
}

export interface StubConfig {
  target: { redisUrl: string };
  activeSlots: string[];
  dbExtraLatencyMs: number;
}

export interface StubEngine {
  url: string;
  config: StubConfig;
  /** Every GET /internal/app-config: the If-None-Match it carried and the status served. */
  configRequests: Array<{ ifNoneMatch?: string; status: number }>;
  pushes: Array<Record<string, unknown>>;
  etag(): string;
  close(): Promise<void>;
}

/** Same ETag/304 behaviour as engine/src/appconfig.ts, so the app is tested against the real contract. */
export async function startStubEngine(initial: StubConfig): Promise<StubEngine> {
  const stub = {
    config: initial,
    configRequests: [] as StubEngine['configRequests'],
    pushes: [] as StubEngine['pushes'],
    etag(): string {
      const c = stub.config;
      return createHash('sha1').update(JSON.stringify([c.target.redisUrl, c.activeSlots, c.dbExtraLatencyMs])).digest('hex').slice(0, 16);
    },
  };
  const server: Server = createServer((req, res) => {
    if (req.method === 'GET' && req.url === '/internal/app-config') {
      const etag = stub.etag();
      const inm = req.headers['if-none-match'];
      res.setHeader('ETag', `"${etag}"`);
      if (inm === `"${etag}"`) {
        stub.configRequests.push({ ifNoneMatch: inm, status: 304 });
        res.statusCode = 304;
        return res.end();
      }
      stub.configRequests.push({ ifNoneMatch: inm, status: 200 });
      res.setHeader('content-type', 'application/json');
      return res.end(JSON.stringify({ ...stub.config, etag }));
    }
    if (req.method === 'POST' && req.url === '/internal/metrics') {
      let body = '';
      req.on('data', (c: Buffer) => (body += c.toString()));
      req.on('end', () => {
        stub.pushes.push(JSON.parse(body) as Record<string, unknown>);
        res.setHeader('content-type', 'application/json');
        res.end('{"ok":true}');
      });
      return;
    }
    res.statusCode = 404;
    res.end();
  });
  const port = await freePort();
  await new Promise<void>((resolve) => server.listen(port, '127.0.0.1', resolve));
  return Object.assign(stub, {
    url: `http://127.0.0.1:${port}`,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  }) as StubEngine;
}

export interface RunningApp {
  url: string;
  proc: ChildProcess;
  output: () => string;
  logFile: string;
  stop(): Promise<void>;
}

export async function startApp(opts: { engineUrl?: string; workspaceDir: string; logDir: string; env?: Record<string, string> }): Promise<RunningApp> {
  const main = path.join(APP_DIR, 'dist', 'main.js');
  if (!existsSync(main)) throw new Error('app/dist/main.js missing: run pnpm --filter @quest/app build first');
  const port = await freePort();
  let out = '';
  const proc = spawn(process.execPath, [main], {
    cwd: REPO,
    env: {
      PATH: process.env.PATH,
      PORT: String(port),
      APP_INSTANCE: `test-${port}`,
      REDIS_URL,
      DATABASE_URL,
      WORKSPACE_DIR: opts.workspaceDir,
      LOG_DIR: opts.logDir,
      ...(opts.engineUrl ? { ENGINE_URL: opts.engineUrl } : {}),
      APP_CONFIG_POLL_MS: '200',
      APP_METRICS_PUSH_MS: '1000',
      APP_FILE_POLL_MS: '200',
      SLOT_TIMEOUT_MS: '1000',
      ...opts.env,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  proc.stdout?.on('data', (c: Buffer) => (out += c.toString()));
  proc.stderr?.on('data', (c: Buffer) => (out += c.toString()));
  const url = `http://127.0.0.1:${port}`;
  const deadline = Date.now() + 15_000;
  for (;;) {
    if (proc.exitCode !== null) throw new Error(`app exited early (${proc.exitCode}):\n${out}`);
    try {
      const r = await fetch(`${url}/app/health`);
      if (r.ok) break;
    } catch {
      /* not up yet */
    }
    if (Date.now() > deadline) throw new Error(`app did not become healthy:\n${out}`);
    await sleep(100);
  }
  return {
    url,
    proc,
    output: () => out,
    logFile: path.join(opts.logDir, 'app', 'app.log'),
    stop: async () => {
      if (proc.exitCode !== null) return;
      const exited = new Promise<void>((resolve) => proc.once('exit', () => resolve()));
      proc.kill('SIGKILL');
      await exited;
    },
  };
}

export const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Poll `fn` until it returns a truthy value or the time runs out. */
export async function waitFor<T>(what: string, fn: () => Promise<T | undefined | false> | T | undefined | false, timeoutMs = 8000): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  let last: unknown;
  for (;;) {
    try {
      const v = await fn();
      if (v) return v;
    } catch (err) {
      last = err;
    }
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}${last ? `: ${String(last)}` : ''}`);
    await sleep(100);
  }
}
