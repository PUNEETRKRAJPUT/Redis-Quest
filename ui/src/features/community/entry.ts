import { Users } from 'lucide-react';
import type { FeatureEntry } from '../types';

export const entry: FeatureEntry = {
  id: 'community',
  enabled: true,
  label: 'Community levels',
  path: '/community',
  blurb: 'Levels written by other players.',
  icon: Users,
};
