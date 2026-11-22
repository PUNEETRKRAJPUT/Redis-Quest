import { GitPullRequest } from 'lucide-react';
import type { FeatureEntry } from '../types';

export const entry: FeatureEntry = {
  id: 'yourturn',
  enabled: true,
  label: 'Your turn',
  path: '/your-turn',
  blurb: 'The last level is a pull request: send your level upstream.',
  icon: GitPullRequest,
};
