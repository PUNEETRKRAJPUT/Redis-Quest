import type { LucideIcon } from 'lucide-react';

/**
 * One extra screen of the game beyond the season (docs/DAYS.md). Each feature owns `<id>/entry.ts` and turns
 * itself on there; until then nothing shows, so branches built in parallel never edit a shared list.
 */
export interface FeatureEntry {
  id: string;
  enabled: boolean;
  label: string;
  /** The route the feature adds under ui/src/app. */
  path: `/${string}`;
  /** One plain sentence for the card on the map and the command palette. */
  blurb: string;
  icon: LucideIcon;
}
