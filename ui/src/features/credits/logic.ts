// The credits' roll: sections built from the engine's data, and the pacing. Pure and tested (D-06).
import type { Progress } from '../../types';
import type { CommunityLevelLine } from '../yourturn/client';

export interface CastMember {
  slug: string;
  name: string;
  nickname: string | null;
  role: string;
}
export interface Contributor {
  name: string;
  github: string | null;
  note: string;
}
/** GET /api/credits: a file the engine could not read is null, not an empty list. */
export interface CreditsData {
  cast: CastMember[] | null;
  contributors: Contributor[] | null;
}

export interface CreditLine {
  id: string;
  primary: string;
  secondary?: string;
}
export interface CreditSection {
  id: 'cast' | 'authors' | 'contributors' | 'you';
  title: string;
  lines: CreditLine[];
  /** Said instead of the lines when there are none. */
  note?: string;
}

export interface PlayerNumbers {
  name: string;
  xp: number;
  levelsPassed: number;
  attempts: number;
  badges: number;
}

/** The player's own numbers from the progress file the shell already holds. */
export function playerNumbers(p: Progress | null): PlayerNumbers | null {
  if (!p) return null;
  let levelsPassed = 0;
  let attempts = 0;
  for (const l of Object.values(p.levels)) {
    if (!l) continue;
    if (l.status === 'passed') levelsPassed++;
    attempts += l.attempts;
  }
  return { name: p.player.name, xp: p.xp, levelsPassed, attempts, badges: p.badges.length };
}

const handle = (github: string | null | undefined) => (github ? ` (@${github})` : '');
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** Community levels grouped by author, in first-seen order; a level with no author is left out. */
export function authorLines(levels: readonly CommunityLevelLine[]): CreditLine[] {
  const by = new Map<string, { name: string; github: string | null; titles: string[] }>();
  for (const l of levels) {
    if (!l.author) continue;
    const key = (l.author.github ?? l.author.name).toLowerCase();
    const e = by.get(key) ?? { name: l.author.name, github: l.author.github ?? null, titles: [] };
    e.titles.push(l.title);
    by.set(key, e);
  }
  return [...by].map(([key, e]) => ({
    id: key,
    primary: `${e.name}${handle(e.github)}`,
    secondary: `${plural(e.titles.length, 'level', 'levels')}: ${e.titles.join(', ')}`,
  }));
}

export function buildSections(input: {
  credits: CreditsData | null;
  community: readonly CommunityLevelLine[] | null;
  player: PlayerNumbers | null;
}): CreditSection[] {
  const { credits, community, player } = input;
  const cast: CreditSection = {
    id: 'cast',
    title: 'The cast',
    lines: (credits?.cast ?? []).map((c) => ({
      id: c.slug,
      primary: c.nickname && c.nickname !== c.name ? `${c.name} (${c.nickname})` : c.name,
      secondary: c.role,
    })),
    ...(credits?.cast ? {} : { note: 'The cast list is not available from the engine right now.' }),
  };
  const authors: CreditSection = {
    id: 'authors',
    title: 'Community levels',
    lines: community ? authorLines(community) : [],
    ...(community === null
      ? { note: 'The community levels could not be read right now.' }
      : community.length === 0
        ? { note: 'No community levels yet. The first one could be yours.' }
        : {}),
  };
  const contribs = credits?.contributors ?? null;
  const contributors: CreditSection = {
    id: 'contributors',
    title: 'Contributors',
    lines: (contribs ?? []).map((c, i) => ({
      id: `${c.github ?? c.name}-${i}`,
      primary: `${c.name}${handle(c.github)}`,
      ...(c.note ? { secondary: c.note } : {}),
    })),
    ...(contribs === null
      ? { note: 'CONTRIBUTORS.md is not available from the engine right now.' }
      : contribs.length === 0
        ? { note: 'Nobody has added a line to CONTRIBUTORS.md yet.' }
        : {}),
  };
  const you: CreditSection = {
    id: 'you',
    title: 'You',
    lines: player
      ? [
          {
            id: 'player',
            primary: player.name,
            secondary: `${player.xp} XP, ${plural(player.levelsPassed, 'level', 'levels')} passed in ${plural(player.attempts, 'attempt', 'attempts')}, ${plural(player.badges, 'badge', 'badges')}`,
          },
        ]
      : [],
    ...(player ? {} : { note: 'Your line appears once you have a save.' }),
  };
  return [cast, authors, contributors, you];
}

// ---- pacing ---------------------------------------------------------------------------------------------------

/** How long a section stays up while the roll plays itself. */
export const SECTION_MS = 6000;

/** The section after a step of `delta`, staying inside 0..count-1 (no wrap: the roll ends on "You"). */
export function stepIndex(index: number, delta: number, count: number): number {
  return Math.min(Math.max(index + delta, 0), Math.max(count - 1, 0));
}

export type RollKey = 'next' | 'prev' | 'first' | 'last' | 'skip' | 'toggle' | null;

/** What a key press means for the roll; keys the roll does not claim give null (so Tab and the rest keep working). */
export function rollKey(key: string): RollKey {
  switch (key) {
    case 'ArrowRight':
    case 'ArrowDown':
    case 'PageDown':
      return 'next';
    case 'ArrowLeft':
    case 'ArrowUp':
    case 'PageUp':
      return 'prev';
    case 'Home':
      return 'first';
    case 'End':
      return 'last';
    case 'Escape':
      return 'skip';
    case ' ':
      return 'toggle';
    default:
      return null;
  }
}
