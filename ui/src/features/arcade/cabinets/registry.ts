import type { Cabinet, ComingCabinet } from '../kit';
import { beTheRedis } from './be-the-redis';

/** The machines on the arcade page, in order. Add a cabinet here (docs/arcade.md). */
export const CABINETS: readonly Cabinet[] = [beTheRedis];

/** Machines announced but not built: shown dimmed with the path of the contributor guide. */
export const COMING: readonly ComingCabinet[] = [
  {
    id: 'be-the-eviction-policy',
    title: 'Be the eviction policy',
    pitch: 'Memory is full and a new key arrives. Decide which one goes.',
  },
];
