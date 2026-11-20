import { PencilRuler } from 'lucide-react';
import type { FeatureEntry } from '../types';

// Off until D-05 ships the screen (docs/specs/D-05-*.md): that task sets `enabled: true` here and adds the route.
export const entry: FeatureEntry = {
  id: 'studio',
  enabled: false,
  label: 'Level studio',
  path: '/studio',
  blurb: 'Write a level of your own and play-test it.',
  icon: PencilRuler,
};
