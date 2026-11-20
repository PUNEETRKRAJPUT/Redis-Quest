import { Smartphone } from 'lucide-react';
import type { FeatureEntry } from '../types';

export const entry: FeatureEntry = {
  id: 'phone',
  enabled: true,
  label: 'The phone',
  path: '/phone',
  blurb: 'The cricket app itself, served by your code. Feel every request.',
  icon: Smartphone,
};
