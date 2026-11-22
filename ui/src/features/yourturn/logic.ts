// "Your turn" and the wanted-commands board: everything that is not drawing (D-06). Pure and tested.
import type { ChaptersResponse } from '../../types';

export const STORAGE_KEY = 'quest.yourturn.v1';
/** The level event the engine emits when a studio play-test passes (docs/handoffs/D-05.md). */
export const PLAYTEST_EVENT = 'studio_playtest_passed';
/** CONTRIBUTING.md is added by another branch and lives in the repository, so the link is to the repository. */
export const CONTRIBUTING_URL =
  'https://github.com/PUNEETRKRAJPUT/Redis-Quest/blob/main/CONTRIBUTING.md';
const FINALE_CHAPTER = 'finale';

// ---- the engine's shapes (GET /api/coverage, docs/handoffs/D-06.md) --------------------------------------------

export interface BoardCommand {
  name: string;
  summary: string;
  taught: boolean;
  usedBy: { levelId: string; via: 'solution' | 'check' }[];
}
export interface BoardGroup {
  group: string;
  total: number;
  taught: number;
  commands: BoardCommand[];
}
export interface BoardData {
  available: true;
  listed: number;
  commands: number;
  taught: number;
  untaught: number;
  skipped: { subcommands: number; modules: number };
  groups: BoardGroup[];
  levelsRead: number;
}
export interface BoardUnavailable {
  available: false;
  reason: string;
}
export type Coverage = BoardData | BoardUnavailable;

/** Reads a coverage response defensively: anything that is not the board is reported as unavailable. */
export function readCoverage(body: unknown): Coverage {
  const b = body as Partial<BoardData> | null;
  if (b && b.available === true && Array.isArray(b.groups)) return b as BoardData;
  const reason = (body as { reason?: unknown } | null)?.reason;
  return {
    available: false,
    reason: typeof reason === 'string' ? reason : 'The engine did not send a command board.',
  };
}

// ---- filtering the board -------------------------------------------------------------------------------------------

export interface BoardFilter {
  query: string;
  untaughtOnly: boolean;
}

/** Keeps the commands whose name or summary holds the query, and drops groups left empty. Counts stay the group's own. */
export function filterGroups(groups: readonly BoardGroup[], f: BoardFilter): BoardGroup[] {
  const q = f.query.trim().toLowerCase();
  const out: BoardGroup[] = [];
  for (const g of groups) {
    const commands = g.commands.filter(
      (c) =>
        (!f.untaughtOnly || !c.taught) &&
        (q === '' ||
          c.name.toLowerCase().includes(q) ||
          c.summary.toLowerCase().includes(q) ||
          g.group.toLowerCase().includes(q)),
    );
    if (commands.length > 0) out.push({ ...g, commands });
  }
  return out;
}

/** The studio, with the command filled in. D-05's screen is linked by path only; `command` is the agreed query. */
export function studioLink(command: string): string {
  return `/studio?command=${encodeURIComponent(command)}`;
}

/** A command name as it may appear in a URL or storage: the server's plain names only. */
export function isCommandName(s: unknown): s is string {
  return typeof s === 'string' && /^[a-z0-9_-]{1,64}$/.test(s);
}

// ---- the three steps -------------------------------------------------------------------------------------------

export interface PlaytestInfo {
  levelId: string;
  pack: string;
  at: string;
}

export interface YourTurnState {
  command: string | null;
  pickedAt: string | null;
  playtest: PlaytestInfo | null;
  prOpenedAt: string | null;
}

export const EMPTY_STATE: YourTurnState = {
  command: null,
  pickedAt: null,
  playtest: null,
  prOpenedAt: null,
};

const str = (v: unknown): string | null => (typeof v === 'string' && v !== '' ? v : null);

/** What was stored, tolerant of anything: garbage gives the empty state, a bad field gives null for that field. */
export function parseState(raw: string | null): YourTurnState {
  if (!raw) return EMPTY_STATE;
  let v: unknown;
  try {
    v = JSON.parse(raw);
  } catch {
    return EMPTY_STATE;
  }
  if (!v || typeof v !== 'object') return EMPTY_STATE;
  const o = v as Record<string, unknown>;
  const command = isCommandName(o.command) ? o.command : null;
  const p = o.playtest as Record<string, unknown> | null | undefined;
  const levelId = str(p?.levelId);
  const pack = str(p?.pack);
  const at = str(p?.at);
  return {
    command,
    pickedAt: command ? str(o.pickedAt) : null,
    playtest: command && levelId && pack && at ? { levelId, pack, at } : null,
    prOpenedAt: command ? str(o.prOpenedAt) : null,
  };
}

/** Picking a different command starts the path again; picking the same one changes nothing. */
export function pickCommand(s: YourTurnState, command: string, now: Date): YourTurnState {
  if (!isCommandName(command) || s.command === command) return s;
  return { command, pickedAt: now.toISOString(), playtest: null, prOpenedAt: null };
}

export function recordPlaytest(s: YourTurnState, p: PlaytestInfo): YourTurnState {
  if (!s.command || (s.playtest && s.playtest.at >= p.at)) return s;
  return { ...s, playtest: p };
}

export function markPullRequest(s: YourTurnState, now: Date): YourTurnState {
  return s.command && s.playtest ? { ...s, prOpenedAt: now.toISOString() } : s;
}

/** An event in the store's shape (from the WebSocket) or the engine's ring (GET /api/events). */
export interface AnyEvent {
  at?: unknown;
  kind?: unknown;
  name?: unknown;
  data?: unknown;
  type?: unknown;
}

/** The ring's `{ at, type: 'level.event', data: { kind, name, data } }` flattened to the store's shape. */
export function flattenRecorded(e: AnyEvent): AnyEvent {
  if (e.type === 'level.event' && e.data && typeof e.data === 'object') {
    const d = e.data as Record<string, unknown>;
    return { at: e.at, kind: d.kind, name: d.name, data: d.data };
  }
  return e;
}

/** The latest passed play-test at or after `since` (null = any), or null when there is none. */
export function playtestFromEvents(
  events: readonly AnyEvent[],
  since: string | null,
): PlaytestInfo | null {
  const floor = since === null ? -Infinity : Date.parse(since);
  let best: PlaytestInfo | null = null;
  for (const raw of events) {
    const e = flattenRecorded(raw);
    if (e.kind !== 'custom' || e.name !== PLAYTEST_EVENT) continue;
    const at = str(e.at);
    const d = e.data as Record<string, unknown> | null | undefined;
    const levelId = str(d?.levelId);
    const pack = str(d?.pack);
    if (!at || !levelId || !pack) continue;
    const t = Date.parse(at);
    if (Number.isNaN(t) || t < floor) continue;
    if (!best || at > best.at) best = { levelId, pack, at };
  }
  return best;
}

export type StepStatus = 'done' | 'current' | 'waiting';
export interface Step {
  id: 'pick' | 'playtest' | 'pull-request';
  title: string;
  status: StepStatus;
}

/** The three steps in order; the first one not done is current, the rest wait. */
export function stepsOf(s: YourTurnState): Step[] {
  const done = [s.command !== null, s.playtest !== null, s.prOpenedAt !== null];
  const titles: [Step['id'], string][] = [
    ['pick', 'Pick a command nobody teaches yet'],
    ['playtest', 'Write it as a level and play-test it in the studio'],
    ['pull-request', 'Send the files upstream as a pull request'],
  ];
  const firstOpen = done.indexOf(false);
  return titles.map(([id, title], i) => ({
    id,
    title,
    status: done[i] ? 'done' : i === firstOpen ? 'current' : 'waiting',
  }));
}

/** A branch-safe slug of a level id, for the commands shown in step three. */
function branchOf(levelId: string): string {
  return `level/${levelId.replace(/[^A-Za-z0-9._-]/g, '-')}`;
}

/** The commands of step three, for the play-tested level (placeholders only where the screen cannot know). */
export function gitCommands(p: Pick<PlaytestInfo, 'levelId' | 'pack'> | null): string[] {
  const pack = p?.pack ?? '<pack>';
  const id = p?.levelId ?? '<level-id>';
  return [
    `git switch -c ${branchOf(id)}`,
    `git add levels/community/${pack} CONTRIBUTORS.md`,
    `git commit -m "Community level: ${id}"`,
    `git push -u origin ${branchOf(id)}`,
    'gh pr create --fill',
  ];
}

// ---- the map's card -------------------------------------------------------------------------------------------

/** True when every level of the Finale chapter is passed. */
export function finalePassed(chapters: ChaptersResponse | null): boolean {
  const finale = chapters?.chapters.find((c) => c.id === FINALE_CHAPTER);
  return !!finale && finale.levels.length > 0 && finale.levels.every((l) => l.status === 'passed');
}

export interface CardState {
  /** The next thing to do: the map card should stand out. */
  next: boolean;
  blurb: string;
}

/**
 * What the map's feature card for "Your turn" says. FeatureStrip is not mine to edit, so this is the function it can
 * call (docs/handoffs/D-06.md): before the Finale the card is simply available, after it the card is the next step.
 */
export function yourTurnCard(chapters: ChaptersResponse | null, plain: string): CardState {
  return finalePassed(chapters)
    ? {
        next: true,
        blurb: 'You finished the season. Now write a level of your own and send it upstream.',
      }
    : { next: false, blurb: plain };
}
