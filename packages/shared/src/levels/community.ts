// D-05. Community levels: `levels/community/<pack>/` holds one chapter-shaped directory per pack (a chapter.yaml and
// NN-slug.yaml level files, in the same format as the campaign) written by people outside the game. They are loaded
// apart from the campaign, so they never take part in XP, badges, locking, `GET /api/chapters` or the 96-level count.
//
// Nothing here throws on bad content, and a broken pack never hides a good one: every problem becomes a LevelError
// on that pack, and the engine lists the pack with its errors instead of refusing to start.

import { readdir, readFile, stat } from 'node:fs/promises';
import { basename, join, resolve } from 'node:path';
import { CANONICAL_CHAPTER_DIRS, loadChapter, type LoadedChapter, type LoadedLevel } from './loader.js';
import { splitCommandLine } from './redis-script.js';
import { formatPath, parseYaml, positionOf, type LevelError, type PathSegment, type YamlSource } from './source.js';

/** Commands a community level may not run in `setup` or in a `.redis` solution (they change the server, not the level's own keys). */
export const COMMUNITY_FORBIDDEN_COMMANDS: ReadonlySet<string> = new Set([
  'FLUSHALL',
  'FLUSHDB',
  'SHUTDOWN',
  'CONFIG',
  'DEBUG',
  'SCRIPT',
  'FUNCTION',
  'EVAL',
  'EVALSHA',
  'FCALL',
  'ACL',
  'SLAVEOF',
  'REPLICAOF',
  'MODULE',
  'MIGRATE',
  'SAVE',
  'BGSAVE',
  'BGREWRITEAOF',
  'CLIENT',
  'SWAPDB',
  'RESTORE',
  'MONITOR',
]);

/** The modes and verifier types a community level may use today (they run against the learner's own Redis and nothing else). */
export const COMMUNITY_MODES = ['cli', 'decision'] as const;
export const COMMUNITY_VERIFY_TYPES = ['redis', 'antipattern', 'quiz', 'answer'] as const;

export interface CommunityPack {
  /** The pack name: the directory name, and the chapter id of its chapter.yaml. */
  id: string;
  dir: string;
  /** Present when chapter.yaml is valid; `levels` holds only the levels that passed every rule. */
  chapter?: LoadedChapter;
  /** Everything wrong in this pack: schema, file, community-rule problems. Empty means the whole pack is good. */
  errors: LevelError[];
  /** Level files (by file name) that did not load, so a list can show them next to the errors. */
  brokenFiles: string[];
}

const KEBAB = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;
export const COMMUNITY_PACK_ID = KEBAB;

function reservedPackIds(): Set<string> {
  const ids = new Set<string>(CANONICAL_CHAPTER_DIRS.map((d) => d.split('-')[0] as string));
  return ids;
}

async function isDir(p: string): Promise<boolean> {
  try {
    return (await stat(p)).isDirectory();
  } catch {
    return false;
  }
}

/** Positions an error in a level file when the YAML parses; 1:1 otherwise. */
class LevelLocator {
  private source: YamlSource | undefined | null = undefined;
  constructor(private readonly file: string) {}
  async error(path: PathSegment[], message: string): Promise<LevelError> {
    if (this.source === undefined) {
      try {
        const parsed = parseYaml(this.file, await readFile(this.file, 'utf8'));
        this.source = parsed.errors.length ? null : parsed.source;
      } catch {
        this.source = null;
      }
    }
    const pos = this.source ? positionOf(this.source, path) : { line: 1, col: 1 };
    return { file: this.file, line: pos.line, col: pos.col, path: formatPath(path), message };
  }
}

function hasGameKey(cmd: readonly string[]): boolean {
  return cmd.some((a) => a.startsWith('game:'));
}

/** The rules a loaded level must meet to live in `levels/community/`. Returns the problems (empty: accepted). */
export async function communityLevelProblems(loaded: LoadedLevel): Promise<LevelError[]> {
  const level = loaded.level;
  const where = new LevelLocator(loaded.file);
  const out: LevelError[] = [];
  const add = async (path: PathSegment[], message: string) => void out.push(await where.error(path, message));

  if (!level.author) await add([], 'a community level needs an author: { name, github? } (the author line is how it is credited)');
  if (!(COMMUNITY_MODES as readonly string[]).includes(level.mode)) {
    await add(['mode'], `community levels are ${COMMUNITY_MODES.join(' or ')} levels for now (found ${level.mode})`);
    return out;
  }

  for (const [i, step] of (level.setup ?? []).entries()) {
    if (!('cmd' in step)) {
      await add(['setup', i], 'community setup steps are Redis commands (cmd); sql and script steps are not allowed');
      continue;
    }
    const name = (step.cmd[0] ?? '').toUpperCase();
    if (COMMUNITY_FORBIDDEN_COMMANDS.has(name)) await add(['setup', i, 'cmd', 0], `${name} is not allowed in a community level's setup`);
  }
  for (const [i, v] of level.verify.entries()) {
    if (!(COMMUNITY_VERIFY_TYPES as readonly string[]).includes(v.type) || (v.type === 'antipattern' && !('checks' in v))) {
      await add(['verify', i, 'type'], `community levels may use ${COMMUNITY_VERIFY_TYPES.join(', ')} verifiers (antipattern with checks only); found ${v.type}`);
      continue;
    }
    if (v.type === 'redis' || v.type === 'antipattern') {
      for (const [j, c] of ('checks' in v ? v.checks : []).entries()) {
        if (c.allowWrite) await add(['verify', i, 'checks', j, 'allowWrite'], 'community checks must be read-only');
        if (hasGameKey(c.cmd)) await add(['verify', i, 'checks', j, 'cmd'], 'the game:* key prefix belongs to the engine');
      }
    } else if (v.type === 'answer' && hasGameKey(v.expected.cmd)) {
      await add(['verify', i, 'expected', 'cmd'], 'the game:* key prefix belongs to the engine');
    }
  }

  // Solution scripts are commands that the play-test (and CI) run; hold them to the same rule as setup.
  if (level.mode === 'cli' && level.solutions) {
    const refs: { rel: string; path: PathSegment[] }[] = [
      { rel: level.solutions.reference, path: ['solutions', 'reference'] },
      ...level.solutions.wrong.map((w, i) => ({ rel: w.path, path: ['solutions', 'wrong', i, 'path'] as PathSegment[] })),
    ];
    for (const r of refs) {
      let text = '';
      try {
        text = await readFile(resolve(loaded.dir, r.rel), 'utf8');
      } catch {
        continue; // the loader already reported a missing file
      }
      for (const argv of splitCommandLine(text)) {
        const name = (argv[0] ?? '').toUpperCase();
        if (COMMUNITY_FORBIDDEN_COMMANDS.has(name)) await add(r.path, `${r.rel} runs ${name}, which is not allowed in a community level`);
        else if (hasGameKey(argv)) await add(r.path, `${r.rel} touches a game:* key; that prefix belongs to the engine`);
      }
    }
  }
  return out;
}

/** Loads one pack directory. Never throws. */
export async function loadCommunityPack(dir: string): Promise<CommunityPack> {
  dir = resolve(dir);
  const id = basename(dir);
  const pack: CommunityPack = { id, dir, errors: [], brokenFiles: [] };
  const fail = (file: string, message: string, path = '(root)') => pack.errors.push({ file, line: 1, col: 1, path, message });
  try {
    if (!COMMUNITY_PACK_ID.test(id)) fail(dir, 'a pack directory is named in kebab-case (lowercase letters, digits, single dashes)');
    if (reservedPackIds().has(id) || id.startsWith('example-')) fail(dir, `${id} is a campaign chapter id; pick another pack name`);
    const r = await loadChapter(dir);
    pack.errors.push(...r.errors);
    if (r.chapter) {
      const chapter = r.chapter;
      if (chapter.id !== id) fail(chapter.file, `the chapter id of a community pack is its directory name (${id}), found ${chapter.id}`, 'id');
      const kept: LoadedLevel[] = [];
      for (const l of chapter.levels) {
        const problems = await communityLevelProblems(l);
        if (problems.length) pack.errors.push(...problems);
        else kept.push(l);
      }
      pack.chapter = { ...chapter, levels: kept };
    }
  } catch (e) {
    fail(dir, `could not read this pack: ${(e as Error).message}`);
  }
  pack.brokenFiles = [
    ...new Set(
      pack.errors
        .map((e) => basename(e.file))
        .filter((f) => f.endsWith('.yaml') && f !== 'chapter.yaml'),
    ),
  ].sort();
  // An id problem means the chapter cannot be offered: its levels' ids would clash with the campaign's.
  if (pack.errors.some((e) => e.path === 'id' && e.file === pack.chapter?.file)) delete pack.chapter;
  return pack;
}

/** Loads every pack under `root` (normally `levels/community`). A missing directory is no packs, not an error. */
export async function loadCommunity(root: string): Promise<CommunityPack[]> {
  root = resolve(root);
  if (!(await isDir(root))) return [];
  let names: string[];
  try {
    names = (await readdir(root, { withFileTypes: true }))
      .filter((e) => e.isDirectory() && !e.name.startsWith('_') && !e.name.startsWith('.') && e.name !== 'node_modules')
      .map((e) => e.name)
      .sort();
  } catch {
    return [];
  }
  const packs: CommunityPack[] = [];
  for (const n of names) packs.push(await loadCommunityPack(join(root, n)));
  return packs;
}
