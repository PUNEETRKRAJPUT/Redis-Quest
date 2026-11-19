/** The player's rank is a pure function of XP: a short ladder with cricket flavour and plain thresholds. */
export interface Rank {
  id: string;
  title: string;
  minXp: number;
}

export const RANKS: readonly Rank[] = [
  { id: 'gully', title: 'Gully player', minXp: 0 },
  { id: 'club', title: 'Club regular', minXp: 150 },
  { id: 'district', title: 'District pick', minXp: 500 },
  { id: 'state', title: 'State cap', minXp: 1200 },
  { id: 'national', title: 'National call-up', minXp: 2500 },
  { id: 'legend', title: 'Legend of the league', minXp: 4500 },
];

export interface RankState {
  rank: Rank;
  /** The rank after this one; null at the top of the ladder. */
  next: Rank | null;
  /** XP still needed for `next`; 0 at the top. */
  toNext: number;
  /** Progress through the current rank, 0 to 1; 1 at the top. */
  progress: number;
}

export function rankFor(xp: number): RankState {
  const safe = Number.isFinite(xp) && xp > 0 ? xp : 0;
  let index = 0;
  for (let i = 0; i < RANKS.length; i++) if (safe >= RANKS[i]!.minXp) index = i;
  const rank = RANKS[index]!;
  const next = RANKS[index + 1] ?? null;
  if (!next) return { rank, next: null, toNext: 0, progress: 1 };
  const span = next.minXp - rank.minXp;
  return { rank, next, toNext: next.minXp - safe, progress: (safe - rank.minXp) / span };
}
