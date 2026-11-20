import { Target } from 'lucide-react';
import type { FeatureEntry } from '../types';

// Off until D-07 ships the screen (docs/specs/D-07-*.md): that task sets `enabled: true` here and adds the route.
export const entry: FeatureEntry = {
  id: 'league',
  enabled: false,
  label: 'Economy League',
  path: '/league',
  blurb: 'Solve it in the fewest commands. Lowest score wins.',
  icon: Target,
};
