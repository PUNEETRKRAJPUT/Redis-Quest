import { Siren } from 'lucide-react';
import type { FeatureEntry } from '../types';

export const entry: FeatureEntry = {
  id: 'matchday',
  enabled: true,
  label: 'Match Day',
  path: '/matchday',
  blurb: 'A survival run against the crowd. Same match for everyone today.',
  icon: Siren,
};
