// Pure helpers behind the season map: what to play next, how far each chapter got, levels grouped into overs.
import type { ChapterSummary, Mode } from '../types';

export type MapLevel = ChapterSummary['levels'][number];

export interface NextMatch {
  chapter: ChapterSummary;
  chapterIndex: number;
  level: MapLevel;
  levelIndex: number;
  /** True when the level was already started: the action says "Continue" instead of "Play". */
  resume: boolean;
}

/** The next playable level: the first one in progress, else the first available one; null when none is left. */
export function nextMatch(chapters: readonly ChapterSummary[]): NextMatch | null {
  for (const status of ['in_progress', 'available'] as const) {
    for (let ci = 0; ci < chapters.length; ci++) {
      const chapter = chapters[ci]!;
      const li = chapter.levels.findIndex((l) => l.status === status);
      if (li >= 0)
        return {
          chapter,
          chapterIndex: ci,
          level: chapter.levels[li]!,
          levelIndex: li,
          resume: status === 'in_progress',
        };
    }
  }
  return null;
}

/**
 * A chapter as a fixture on the season path. `complete`: every level passed (lit). `current`: holds the next
 * match. `open`: something is playable or passed but it is not the next match. `upcoming`: all locked (dim).
 */
export type FixtureState = 'complete' | 'current' | 'open' | 'upcoming';

export function fixtureState(chapter: ChapterSummary, isCurrent: boolean): FixtureState {
  const total = chapter.levels.length;
  const passed = passedIn(chapter);
  if (total > 0 && passed === total) return 'complete';
  if (isCurrent) return 'current';
  if (chapter.levels.some((l) => l.status !== 'locked')) return 'open';
  return 'upcoming';
}

export const passedIn = (chapter: ChapterSummary): number =>
  chapter.levels.filter((l) => l.status === 'passed').length;

/** Levels in overs of six; the last over is short when the count is not a multiple of six. */
export function overs<T>(items: readonly T[], size = 6): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

export interface SeasonTotals {
  passed: number;
  total: number;
  chaptersComplete: number;
}

export function seasonTotals(chapters: readonly ChapterSummary[]): SeasonTotals {
  let passed = 0;
  let total = 0;
  let chaptersComplete = 0;
  for (const c of chapters) {
    const p = passedIn(c);
    passed += p;
    total += c.levels.length;
    if (c.levels.length > 0 && p === c.levels.length) chaptersComplete++;
  }
  return { passed, total, chaptersComplete };
}

/** Plain words for a level's mode. */
export const MODE_LABEL: Record<Mode, string> = {
  cli: 'Terminal',
  code: 'Code',
  ops: 'Ops',
  decision: 'Decision',
};

export const modeLabel = (mode: string): string => MODE_LABEL[mode as Mode] ?? mode;

/** "Match 03": two digits, counted from 1. */
export const matchNumber = (index: number): string => String(index + 1).padStart(2, '0');
