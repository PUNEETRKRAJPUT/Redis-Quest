import { Clapperboard } from 'lucide-react';
import type { FeatureEntry } from '../types';

export const entry: FeatureEntry = {
  id: 'credits',
  enabled: true,
  label: 'Credits',
  path: '/credits',
  blurb: 'Everyone who built the league.',
  icon: Clapperboard,
};
