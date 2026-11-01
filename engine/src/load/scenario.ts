// Load scenarios: scenarios/<id>.yaml, the believable-players layer on top of autocannon.
// The format is documented in scenarios/README.md; this parser is its contract.

import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { parse as parseYaml } from 'yaml';
import type { LoadCaps } from '../verify/config.js';

export type Distribution = 'uniform' | 'zipf';

export interface ValuePool {
  values: string[];
  distribution: Distribution;
  zipfSkew?: number;
}

export interface ScenarioRequest {
  method: string;
  /** Starts with /app/; `{user}` and `{<param>}` are replaced per request. */
  path: string;
  weight: number;
  /** Header that carries the sampled user id, e.g. x-user-id. */
  userIdHeader?: string;
  /** JSON body (strings inside are templated like the path). */
  body?: unknown;
}

export interface Scenario {
  id: string;
  description?: string;
  durationSec: number;
  connections: number;
  pipelining: number;
  seed: number;
  warmup?: { durationSec: number; connections: number };
  users: {
    count: number;
    distribution: Distribution;
    zipfSkew?: number;
    idPattern: string;
    pad: number;
  };
  params: Record<string, ValuePool>;
  requests: ScenarioRequest[];
}

export class ScenarioError extends Error {}

const KEBAB = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const METHODS = new Set(['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD']);
const TOP_KEYS = new Set([
  'id',
  'description',
  'durationSec',
  'connections',
  'pipelining',
  'seed',
  'warmup',
  'users',
  'params',
  'requests',
]);

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => !!v && typeof v === 'object' && !Array.isArray(v);

function int(v: unknown, path: string, min: number, max: number): number {
  if (typeof v !== 'number' || !Number.isInteger(v) || v < min || v > max) {
    throw new ScenarioError(`${path} must be an integer from ${min} to ${max}`);
  }
  return v;
}

function unknownKeys(o: Obj, allowed: readonly string[], path: string): void {
  for (const k of Object.keys(o))
    if (!allowed.includes(k)) throw new ScenarioError(`${path}: unknown key '${k}'`);
}

function distribution(o: Obj, path: string): { distribution: Distribution; zipfSkew?: number } {
  const d = o.distribution ?? 'uniform';
  if (d !== 'uniform' && d !== 'zipf')
    throw new ScenarioError(`${path}.distribution must be uniform or zipf`);
  if (d === 'zipf') {
    const s = o.zipfSkew;
    if (typeof s !== 'number' || !(s > 0) || s > 5)
      throw new ScenarioError(
        `${path}.zipfSkew must be a number above 0 (at most 5) for a zipf distribution`,
      );
    return { distribution: d, zipfSkew: s };
  }
  if (o.zipfSkew !== undefined)
    throw new ScenarioError(`${path}.zipfSkew is only used with distribution: zipf`);
  return { distribution: d };
}

/** Validates a parsed scenario. `expectedId` is the file name without .yaml. */
export function parseScenario(raw: unknown, expectedId?: string): Scenario {
  if (!isObj(raw)) throw new ScenarioError('a scenario file must be a YAML mapping');
  for (const k of Object.keys(raw))
    if (!TOP_KEYS.has(k)) throw new ScenarioError(`unknown key '${k}'`);
  const id = raw.id;
  if (typeof id !== 'string' || !KEBAB.test(id)) throw new ScenarioError('id must be kebab-case');
  if (expectedId !== undefined && id !== expectedId)
    throw new ScenarioError(`id must be ${expectedId} (the file name), found ${id}`);
  if (raw.description !== undefined && typeof raw.description !== 'string')
    throw new ScenarioError('description must be a string');

  let warmup: Scenario['warmup'];
  if (raw.warmup !== undefined) {
    if (!isObj(raw.warmup)) throw new ScenarioError('warmup must be { durationSec, connections }');
    unknownKeys(raw.warmup, ['durationSec', 'connections'], 'warmup');
    warmup = {
      durationSec: int(raw.warmup.durationSec, 'warmup.durationSec', 1, 30),
      connections: int(raw.warmup.connections, 'warmup.connections', 1, 1000),
    };
  }

  if (!isObj(raw.users)) throw new ScenarioError('users must be { count, distribution, ... }');
  unknownKeys(raw.users, ['count', 'distribution', 'zipfSkew', 'idPattern', 'pad'], 'users');
  const idPattern = raw.users.idPattern ?? 'u-{n}';
  if (typeof idPattern !== 'string' || !idPattern.includes('{n}'))
    throw new ScenarioError('users.idPattern must be a string containing {n}');
  const users = {
    count: int(raw.users.count, 'users.count', 1, 1_000_000),
    ...distribution(raw.users, 'users'),
    idPattern,
    pad: raw.users.pad === undefined ? 6 : int(raw.users.pad, 'users.pad', 0, 12),
  };

  const params: Record<string, ValuePool> = {};
  if (raw.params !== undefined) {
    if (!isObj(raw.params))
      throw new ScenarioError('params must be a mapping of name to { values, distribution }');
    for (const [name, p] of Object.entries(raw.params)) {
      if (!/^[a-z][a-zA-Z0-9]*$/.test(name) || name === 'user')
        throw new ScenarioError(
          `params.${name}: names are camelCase words, and 'user' is reserved`,
        );
      if (!isObj(p)) throw new ScenarioError(`params.${name} must be { values, distribution }`);
      unknownKeys(p, ['values', 'distribution', 'zipfSkew'], `params.${name}`);
      if (
        !Array.isArray(p.values) ||
        p.values.length === 0 ||
        !p.values.every((x) => typeof x === 'string' || typeof x === 'number')
      ) {
        throw new ScenarioError(
          `params.${name}.values must be a non-empty list of strings or numbers`,
        );
      }
      params[name] = { values: p.values.map(String), ...distribution(p, `params.${name}`) };
    }
  }

  if (!Array.isArray(raw.requests) || raw.requests.length === 0)
    throw new ScenarioError('requests must be a non-empty list');
  const requests = raw.requests.map((r, i): ScenarioRequest => {
    const path = `requests[${i}]`;
    if (!isObj(r)) throw new ScenarioError(`${path} must be { method, path, weight }`);
    unknownKeys(r, ['method', 'path', 'weight', 'userIdHeader', 'body'], path);
    const method = typeof r.method === 'string' ? r.method.toUpperCase() : '';
    if (!METHODS.has(method))
      throw new ScenarioError(`${path}.method must be one of ${[...METHODS].join(', ')}`);
    if (typeof r.path !== 'string' || !r.path.startsWith('/app/'))
      throw new ScenarioError(
        `${path}.path must start with /app/ (the app serves everything under /app)`,
      );
    for (const m of r.path.matchAll(/\{([^}]*)\}/g)) {
      const name = m[1] ?? '';
      if (name !== 'user' && !params[name])
        throw new ScenarioError(
          `${path}.path uses {${name}}, which is neither {user} nor a declared param`,
        );
    }
    const weight = r.weight ?? 1;
    if (typeof weight !== 'number' || !(weight > 0))
      throw new ScenarioError(`${path}.weight must be a positive number`);
    if (
      r.userIdHeader !== undefined &&
      (typeof r.userIdHeader !== 'string' || !/^[A-Za-z0-9-]+$/.test(r.userIdHeader))
    ) {
      throw new ScenarioError(`${path}.userIdHeader must be a header name like x-user-id`);
    }
    return {
      method,
      path: r.path,
      weight,
      ...(r.userIdHeader ? { userIdHeader: r.userIdHeader as string } : {}),
      ...(r.body !== undefined ? { body: r.body } : {}),
    };
  });

  return {
    id,
    ...(typeof raw.description === 'string' ? { description: raw.description } : {}),
    durationSec: int(raw.durationSec, 'durationSec', 1, 600),
    connections: int(raw.connections, 'connections', 1, 10_000),
    pipelining: raw.pipelining === undefined ? 1 : int(raw.pipelining, 'pipelining', 1, 100),
    seed: raw.seed === undefined ? 1 : int(raw.seed, 'seed', 0, 2 ** 31 - 1),
    ...(warmup ? { warmup } : {}),
    users,
    params,
    requests,
  };
}

export async function loadScenario(dir: string, id: string): Promise<Scenario> {
  if (!KEBAB.test(id)) throw new ScenarioError(`scenario id ${id} must be kebab-case`);
  let text: string;
  try {
    text = await readFile(join(dir, `${id}.yaml`), 'utf8');
  } catch {
    throw new ScenarioError(`scenarios/${id}.yaml does not exist`);
  }
  let raw: unknown;
  try {
    raw = parseYaml(text);
  } catch (err) {
    throw new ScenarioError(`scenarios/${id}.yaml is not valid YAML: ${(err as Error).message}`);
  }
  return parseScenario(raw, id);
}

/** Identity of a scenario's content, so a baseline recorded for an older version is re-recorded. */
export function scenarioHash(s: Scenario): string {
  return createHash('sha1').update(JSON.stringify(s)).digest('hex').slice(0, 16);
}

export interface EffectiveLoad {
  connections: number;
  durationSec: number;
  warmup?: { durationSec: number; connections: number };
  capped: { connections: boolean; durationSec: boolean };
}

/** Applies the hard caps (LOAD_MAX_CONNECTIONS, LOAD_MAX_DURATION_SEC, LOW_POWER) to a scenario. */
export function applyCaps(s: Scenario, caps: LoadCaps): EffectiveLoad {
  const connections = Math.min(s.connections, caps.maxConnections);
  const durationSec = Math.min(s.durationSec, caps.maxDurationSec);
  return {
    connections,
    durationSec,
    ...(s.warmup
      ? {
          warmup: {
            durationSec: Math.min(s.warmup.durationSec, caps.maxDurationSec),
            connections: Math.min(s.warmup.connections, caps.maxConnections),
          },
        }
      : {}),
    capped: { connections: connections < s.connections, durationSec: durationSec < s.durationSec },
  };
}
