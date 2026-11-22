import { Gamepad2 } from 'lucide-react';
import type { FeatureEntry } from '../types';

// On: D-08 ships the screen at /arcade (ui/src/app/arcade) and the first cabinet (docs/arcade.md).
export const entry: FeatureEntry = {
  id: 'arcade',
  enabled: true,
  label: 'Arcade',
  path: '/arcade',
  blurb: 'Be the Redis: run the commands yourself, one at a time.',
  icon: Gamepad2,
};
