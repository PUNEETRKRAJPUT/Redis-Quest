// The Economy League: hole and entry formats, the loader, the scorer and the ranking (D-07).
export { splitArgs } from './split.js';
export { REFUSED_COMMANDS, refusalFor } from './refuse.js';
export { HANDLE, HOLE_ID, PAR_MAX, holeSchema, type Hole, type HoleCheck } from './schema.js';
export {
  MAX_ENTRY_BYTES,
  MAX_ENTRY_COMMANDS,
  handleFromFileName,
  parseEntry,
  type EntryCommand,
  type ParsedEntry,
} from './entry.js';
export {
  HOLE_FILE,
  loadLeague,
  parseHole,
  type LeagueLoadResult,
  type LoadedHole,
} from './loader.js';
export {
  LEAGUE_DB,
  assertScratch,
  keysNamedBy,
  scoreEntry,
  type CheckOutcome,
  type HoleRef,
  type RunCommand,
  type ScoreFailure,
  type ScoreOptions,
  type ScoreResult,
} from './score.js';
export {
  compareScores,
  rankAttempt,
  rankBoard,
  sortBoard,
  type AttemptRank,
  type BoardRow,
  type ScoreKey,
} from './rank.js';
export { openScratch, type Scratch } from './scratch.js';
