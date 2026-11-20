import { entry as arcade } from './arcade/entry';
import { entry as community } from './community/entry';
import { entry as credits } from './credits/entry';
import { entry as league } from './league/entry';
import { entry as matchday } from './matchday/entry';
import { entry as phone } from './phone/entry';
import { entry as studio } from './studio/entry';
import type { FeatureEntry } from './types';
import { entry as yourturn } from './yourturn/entry';

/** Every extra screen, in the order the map and the palette show them. */
export const ALL_FEATURES: readonly FeatureEntry[] = [
  phone,
  matchday,
  league,
  arcade,
  studio,
  community,
  yourturn,
  credits,
];

/** Only the ones that have shipped. */
export const FEATURES: readonly FeatureEntry[] = ALL_FEATURES.filter((f) => f.enabled);
