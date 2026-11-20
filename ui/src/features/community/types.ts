import type { LevelData, ThreadMessage } from '../../types';

export interface CommunityAuthor {
  name: string;
  github?: string;
}
export type CommunityStatus = 'new' | 'in_progress' | 'passed';

export interface CommunityLevelRow {
  id: string;
  title: string;
  mode: 'cli' | 'decision';
  number: number;
  author: CommunityAuthor | null;
  status: CommunityStatus;
  attempts: number;
}
export interface CommunityPack {
  id: string;
  title: string | null;
  incident: ThreadMessage[];
  levels: CommunityLevelRow[];
  brokenFiles: string[];
  /** `file:line:col path: message`, relative to the levels directory. */
  errors: string[];
}
export interface CommunityList {
  packs: CommunityPack[];
  levelCount: number;
  errorCount: number;
}

/** GET /api/community/levels/:id: the campaign's LevelData, with a status that may be `new` and a byline. */
export type CommunityLevelData = Omit<LevelData, 'status'> & {
  status: CommunityStatus;
  community: { pack: string; author: CommunityAuthor | null };
};

/** The shared level components (checks list, brainstorm) read LevelData; a community level that was never started is "available". */
export function asLevelData(l: CommunityLevelData): LevelData {
  return { ...l, status: l.status === 'new' ? 'available' : l.status };
}

export function byline(a: CommunityAuthor | null): string {
  if (!a) return 'Unknown author';
  return a.github ? `${a.name} (@${a.github})` : a.name;
}
