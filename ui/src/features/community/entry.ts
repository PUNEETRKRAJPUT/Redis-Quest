import { Users } from 'lucide-react';
import type { FeatureEntry } from '../types';

// Off until D-05 ships the screen (docs/specs/D-05-*.md): that task sets `enabled: true` here and adds the route.
export const entry: FeatureEntry = {
  id: 'community',
  enabled: false,
  label: 'Community levels',
  path: '/community',
  blurb: 'Levels written by other players.',
  icon: Users,
};
