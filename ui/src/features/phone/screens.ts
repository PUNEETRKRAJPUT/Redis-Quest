import { Activity, Radio, Trophy, User } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

/**
 * The four screens of the cricket app, each one a read the app answers today (docs/handoffs/D-04.md): the route,
 * the slot a learner fills, and the level that builds it. The wallet and contest routes are POSTs, so they are
 * not a screen.
 */
export interface PhoneScreenDef {
  id: 'player' | 'fixtures' | 'board' | 'live';
  label: string;
  title: string;
  path: string;
  /** The slot the route runs, or null for a route that has none. */
  slot: string | null;
  level: string;
  icon: LucideIcon;
}

export const PHONE_SCREENS: readonly PhoneScreenDef[] = [
  {
    id: 'player',
    label: 'Player',
    title: 'Player stats',
    path: '/app/players/p-028/stats',
    slot: 'cache.getPlayerStats',
    level: 'Level 2.2 (cache-aside)',
    icon: User,
  },
  {
    id: 'fixtures',
    label: 'Fixtures',
    title: 'Fixtures',
    path: '/app/fixtures',
    slot: 'prefetch.getFixtures',
    level: 'Level 2.7 (fixtures must never miss)',
    icon: Activity,
  },
  {
    id: 'board',
    label: 'Board',
    title: 'Contest leaderboard',
    path: '/app/leaderboard/1?limit=10',
    slot: 'leaderboard.top',
    level: 'Level 3.6 (the real leaderboard)',
    icon: Trophy,
  },
  {
    id: 'live',
    label: 'Live',
    title: 'Live ticker',
    path: '/app/ticker/m-041',
    slot: null,
    level: 'Level 3.10 (the ticker)',
    icon: Radio,
  },
];
