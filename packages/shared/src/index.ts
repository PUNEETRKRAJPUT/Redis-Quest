// Placeholder types; later tasks fill these in.
export type LevelId = string;
export type SlotName = string;
export interface Progress {
  version: 1;
}

// Level file schema, loader, validator and verdict rule (P0-05).
export * from './levels/index.js';

// Learner-code runtime: deps injection, counting proxies, loader, caller, metrics (P0-08).
export * from './learner/index.js';
