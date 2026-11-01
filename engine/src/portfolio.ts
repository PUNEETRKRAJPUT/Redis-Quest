// E-04: "your story", the learner's portfolio page, built from the save (progress.json), the level files and
// the workspace tree. Nothing here invents a claim: every number is read from the save, and every sentence names
// the level it is about. Where the save has no number for a level, the line has no number.

import type { LoadedChapter, LoadedLevel } from '@quest/shared';
import type { LevelProgress, ProgressFile, VerdictMetrics } from './progress.js';
import type { TreeEntry } from './workspace.js';

export const PORTFOLIO_FILE = 'PORTFOLIO.md';

export interface PortfolioInput {
  progress: ProgressFile;
  chapters: readonly LoadedChapter[];
  tree: readonly TreeEntry[];
}

export interface PortfolioStats {
  player: { id: string; name: string };
  xp: number;
  badges: string[];
  levelsPassed: number;
  levelsTotal: number;
  chapters: { id: string; title: string; passed: number; total: number }[];
  /** Passed levels whose passing verdict carries traffic numbers. */
  traffic: { levelId: string; title: string; metrics: VerdictMetrics }[];
  /** Passed interview levels with a recorded time. */
  interviews: {
    levelId: string;
    title: string;
    minutes: number;
    elapsedMs: number;
    overtime: boolean;
    hintsBought: number;
    drawn: { id: string; title: string | null } | null;
  }[];
  brainstorms: number;
  workspace: { files: number; bytes: number };
}

export interface Portfolio {
  markdown: string;
  stats: PortfolioStats;
}

/** m:ss, rounding down. */
export function clock(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}

const group = (n: number): string => Math.round(n).toLocaleString('en-US');
const ms = (n: number): string => (n >= 100 ? group(n) : String(Math.round(n * 10) / 10));
// Two significant digits below 1, so a small number is never rounded down to 0.
const small = (n: number): string =>
  String(n >= 1 ? Math.round(n * 100) / 100 : Number(n.toPrecision(2)));

/** Learner-typed text goes into markdown as plain text: no emphasis, links, html or table pipes. */
export function escapeMd(s: string): string {
  return s
    .replace(/[\\`*_[\]<>|]/g, (c) => `\\${c}`)
    .replace(/\s+/g, ' ')
    .trim();
}

/** The numbers of a traffic check as phrases; each phrase appears only when the save has the numbers it needs. */
export function metricPhrases(m: VerdictMetrics): string[] {
  const out: string[] = [];
  if (m.p99Ms !== undefined && m.baselineP99Ms !== undefined)
    out.push(`p99 ${ms(m.baselineP99Ms)} ms to ${ms(m.p99Ms)} ms`);
  else if (m.p99Ms !== undefined) out.push(`p99 ${ms(m.p99Ms)} ms under the check's load`);
  if (m.dbPerRequest !== undefined && m.baselineDbPerRequest !== undefined)
    out.push(
      `Postgres calls per request ${small(m.baselineDbPerRequest)} to ${small(m.dbPerRequest)}`,
    );
  else if (m.dbPerRequest !== undefined)
    out.push(`${small(m.dbPerRequest)} Postgres calls per request`);
  if (m.redisPerRequest !== undefined)
    out.push(`Redis commands per request ${small(m.redisPerRequest)}`);
  if (m.hitRatio !== undefined)
    out.push(`${Math.floor(m.hitRatio * 1000) / 10}% of requests made no Postgres call`);
  if (m.rps !== undefined) out.push(`${group(m.rps)} requests per second`);
  return out;
}

const isBackup = (path: string): boolean => /\.before-/.test(path);
const isShim = (path: string): boolean => path.split('/').some((s) => s.startsWith('_bundle-'));

/** The workspace files the page lists: no backups, no bundle shims, not the portfolio itself. */
export function portfolioFiles(tree: readonly TreeEntry[]): { path: string; size: number }[] {
  return tree
    .filter(
      (e) => e.type === 'file' && !isBackup(e.path) && !isShim(e.path) && e.path !== PORTFOLIO_FILE,
    )
    .map((e) => ({ path: e.path, size: e.size ?? 0 }));
}

function passingVerdict(lp: LevelProgress) {
  return lp.verdicts.find((v) => v.verdict === 'right');
}

export function buildPortfolio(input: PortfolioInput): Portfolio {
  const { progress: p, chapters, tree } = input;
  const byId = new Map<string, LoadedLevel>();
  for (const c of chapters) for (const l of c.levels) byId.set(l.level.id, l);
  const titleOf = (id: string): string | null => byId.get(id)?.level.title ?? null;
  const named = (id: string): string => {
    const t = titleOf(id);
    return t ? `"${t}" (${id})` : id;
  };

  const stats: PortfolioStats = {
    player: { id: p.player.id, name: p.player.name },
    xp: p.xp,
    badges: [...p.badges],
    levelsPassed: 0,
    levelsTotal: 0,
    chapters: [],
    traffic: [],
    interviews: [],
    brainstorms: 0,
    workspace: { files: 0, bytes: 0 },
  };

  // One pass in play order: a line for every passed level, and the facts the closing section is made of.
  const chapterSections: string[] = [];
  const said: string[] = [];
  const thought: string[] = [];
  for (const c of chapters) {
    const lines: string[] = [];
    let passed = 0;
    for (const l of c.levels) {
      stats.levelsTotal += 1;
      const lv = l.level;
      const lp = p.levels[lv.id];
      if (lp?.brainstorm) {
        const opt = lv.brainstorm.options.find((o) => o.id === lp.brainstorm?.optionId);
        stats.brainstorms += 1;
        thought.push(
          `- **${lv.title}** (${lv.id}): I picked "${opt?.label ?? lp.brainstorm.optionId}", and wrote: ${escapeMd(lp.brainstorm.text)}`,
        );
      }
      if (lp?.status !== 'passed') continue;
      passed += 1;
      stats.levelsPassed += 1;
      const metrics = passingVerdict(lp)?.metrics;
      const phrases = metrics ? metricPhrases(metrics) : [];
      if (metrics && phrases.length > 0)
        stats.traffic.push({ levelId: lv.id, title: lv.title, metrics });

      const iv = lv.mode === 'code' ? lv.interview : undefined;
      let detail = phrases.join('; ');
      if (iv && lp.interviewElapsedMs !== undefined) {
        const drawnId = iv.pool ? lp.drawn : undefined;
        const when = `${clock(lp.interviewElapsedMs)}${lp.overtime ? `, over the ${iv.minutes}:00 limit` : ''}`;
        const hints = lp.hintsBought
          ? ` with ${lp.hintsBought} hint${lp.hintsBought === 1 ? '' : 's'} bought`
          : '';
        const blank = iv.pool && lp.blanked !== undefined ? ' from a blank file' : '';
        stats.interviews.push({
          levelId: lv.id,
          title: lv.title,
          minutes: iv.minutes,
          elapsedMs: lp.interviewElapsedMs,
          overtime: lp.overtime === true,
          hintsBought: lp.hintsBought ?? 0,
          drawn: drawnId ? { id: drawnId, title: titleOf(drawnId) } : null,
        });
        const rebuilt = `rebuilt in ${when}`;
        detail = drawnId
          ? `the interviewer drew ${named(drawnId)}; ${rebuilt}${blank}${hints}`
          : `${rebuilt}${hints}`;
        said.push(
          drawnId
            ? `- On ${named(lv.id)} the interviewer drew ${named(drawnId)} and I rebuilt it${blank} in ${when}${hints}.`
            : `- On ${named(lv.id)} I rebuilt ${iv.rebuild_of ? named(iv.rebuild_of) : 'the level'} in ${when}${hints}.`,
        );
      } else if (phrases.length > 0) {
        said.push(`- On ${named(lv.id)} the traffic check measured ${phrases.join('; ')}.`);
      }
      lines.push(`- **${lv.title}** (${lv.id})${detail ? `: ${detail}` : ''}`);
    }
    stats.chapters.push({ id: c.id, title: c.chapter.title, passed, total: c.levels.length });
    if (passed > 0)
      chapterSections.push(
        `## ${c.chapter.title}\n\n${passed} of ${c.levels.length} levels passed.\n\n${lines.join('\n')}`,
      );
  }

  const files = portfolioFiles(tree);
  stats.workspace = { files: files.length, bytes: files.reduce((n, f) => n + f.size, 0) };

  const name = escapeMd(p.player.name);
  const head = [
    `# ${name}'s Redis Quest portfolio`,
    '',
    `${stats.levelsPassed} of ${stats.levelsTotal} levels passed, ${group(p.xp)} XP, ${p.badges.length} badge${p.badges.length === 1 ? '' : 's'}${p.badges.length ? `: ${p.badges.join(', ')}` : ''}.`,
    '',
    'Written from my save file and my workspace. Every number below was measured by the game; every line names its level.',
  ];
  const parts: string[] = [head.join('\n')];
  parts.push(
    chapterSections.length > 0
      ? chapterSections.join('\n\n')
      : '## Levels\n\nNo level passed yet. Pass one and it shows up here.',
  );
  parts.push(
    `## How I thought about it\n\n${
      thought.length > 0
        ? thought.join('\n')
        : 'No brainstorm lines in my save yet. Each level asks for one before the build.'
    }`,
  );
  parts.push(
    `## What is in my workspace\n\n${
      files.length > 0
        ? files
            .map((f) => `- \`${f.path}\` (${f.size === 0 ? 'empty' : `${group(f.size)} bytes`})`)
            .join('\n')
        : 'No files in the workspace yet.'
    }`,
  );
  parts.push(
    `## What I would say in an interview\n\n${
      said.length > 0
        ? said.join('\n')
        : 'My save has no measured numbers yet: no traffic check passed and no interview rebuilt. Those are the levels this section is made from.'
    }`,
  );
  return { markdown: `${parts.join('\n\n')}\n`, stats };
}
