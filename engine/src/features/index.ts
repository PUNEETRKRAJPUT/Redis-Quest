import type { FastifyInstance } from 'fastify';
import type { Deps } from '../server.js';
import { coverage } from './coverage.js';
import { editorTypes } from './editor-types.js';
import { league } from './league.js';
import { matchday } from './matchday.js';
import { phone } from './phone.js';
import { studio } from './studio.js';

/**
 * A feature adds its routes under /api from a file of its own instead of editing server.ts. Each file in this
 * folder belongs to one task of the ten-day plan (docs/DAYS.md), so branches built in parallel do not collide.
 * `api` is the Fastify scope that already carries the /api prefix: `api.get('/league')` serves /api/league.
 */
export interface FeatureContext {
  api: FastifyInstance;
  deps: Deps;
}

export interface Feature {
  name: string;
  register(ctx: FeatureContext): void | Promise<void>;
}

export const FEATURES: readonly Feature[] = [
  editorTypes,
  phone,
  studio,
  coverage,
  league,
  matchday,
];

export async function registerFeatures(ctx: FeatureContext): Promise<void> {
  for (const feature of FEATURES) await feature.register(ctx);
}
