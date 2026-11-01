// Learner-code runtime shared by the runner (child process) and the app (in-process), P0-08.
export * from './types.js';
export { countRedis } from './counting.js';
export type { CountingOptions } from './counting.js';
export { failFast, commandTimeoutFromEnv, RedisCommandTimeoutError } from './failfast.js';
export {
  createLearnerDeps,
  createCachedRedis,
  clientIsReady,
  reconnectStrategyFor,
} from './deps.js';
export type {
  CreateLearnerDepsOptions,
  LearnerContext,
  CreateCachedRedisOptions,
  CachedRedisHandle,
} from './deps.js';
export { loadLearnerModule, resolveWorkspacePath, LearnerModuleError } from './loader.js';
export type { LoadedLearnerModule } from './loader.js';
export {
  callLearner,
  runLearnerCalls,
  toLearnerError,
  toJsonValue,
  LearnerTimeoutError,
} from './call.js';
export type { RunCallsOptions } from './call.js';
export { aggregateMetrics, percentile } from './metrics.js';
export {
  parseTarget,
  describeTarget,
  createTargetClient,
  isCluster,
  isSentinel,
  TargetError,
} from './target.js';
export type { TargetKind, ParsedTarget, TargetClientOptions, TargetClient } from './target.js';
