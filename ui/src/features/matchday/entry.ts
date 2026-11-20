import { Siren } from 'lucide-react';
import type { FeatureEntry } from '../types';

// Off until D-09 ships the screen (docs/specs/D-09-*.md): that task sets `enabled: true` here and adds the route.
export const entry: FeatureEntry = {
  id: 'matchday',
  enabled: false,
  label: 'Match Day',
  path: '/matchday',
  blurb: 'A survival run against the crowd. Same match for everyone today.',
  icon: Siren,
};
