import { Smartphone } from 'lucide-react';
import type { FeatureEntry } from '../types';

// Off until D-04 ships the screen (docs/specs/D-04-*.md): that task sets `enabled: true` here and adds the route.
export const entry: FeatureEntry = {
  id: 'phone',
  enabled: false,
  label: 'The phone',
  path: '/phone',
  blurb: 'The cricket app itself, served by your code. Feel every request.',
  icon: Smartphone,
};
