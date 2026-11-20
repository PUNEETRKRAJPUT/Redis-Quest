import { Target } from 'lucide-react';
import type { FeatureEntry } from '../types';

export const entry: FeatureEntry = {
  id: 'league',
  enabled: true,
  label: 'Economy League',
  path: '/league',
  blurb: 'Solve it in the fewest commands. Lowest score wins.',
  icon: Target,
};
