import { PencilRuler } from 'lucide-react';
import type { FeatureEntry } from '../types';

export const entry: FeatureEntry = {
  id: 'studio',
  enabled: true,
  label: 'Level studio',
  path: '/studio',
  blurb: 'Write a level of your own and play-test it.',
  icon: PencilRuler,
};
