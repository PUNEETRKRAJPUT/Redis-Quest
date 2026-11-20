import { Clapperboard } from 'lucide-react';
import type { FeatureEntry } from '../types';

// Off until D-06 ships the screen (docs/specs/D-06-*.md): that task sets `enabled: true` here and adds the route.
export const entry: FeatureEntry = {
  id: 'credits',
  enabled: false,
  label: 'Credits',
  path: '/credits',
  blurb: 'Everyone who built the league.',
  icon: Clapperboard,
};
