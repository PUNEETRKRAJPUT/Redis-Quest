import { Gamepad2 } from 'lucide-react';
import type { FeatureEntry } from '../types';

// Off until D-08 ships the screen (docs/specs/D-08-*.md): that task sets `enabled: true` here and adds the route.
export const entry: FeatureEntry = {
  id: 'arcade',
  enabled: false,
  label: 'Arcade',
  path: '/arcade',
  blurb: 'Be the Redis: run the commands yourself, one at a time.',
  icon: Gamepad2,
};
