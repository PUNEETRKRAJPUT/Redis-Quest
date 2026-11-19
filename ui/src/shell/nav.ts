// The six places the HUD, the command palette and the `g` shortcuts all lead to, defined once.
import {
  Activity,
  Code,
  Map as MapIcon,
  ScrollText,
  SquareTerminal,
  Trophy,
  type LucideIcon,
} from 'lucide-react';
import type { Route } from '../routes';

export interface NavItem {
  id: string;
  label: string;
  route: Route;
  icon: LucideIcon;
  /** The key after `g`: `g` then `t` opens the terminal. */
  key: string;
}

export const NAV: readonly NavItem[] = [
  { id: 'home', label: 'Map', route: { name: 'home' }, icon: MapIcon, key: 'm' },
  {
    id: 'terminal',
    label: 'Terminal',
    route: { name: 'terminal' },
    icon: SquareTerminal,
    key: 't',
  },
  { id: 'editor', label: 'Editor', route: { name: 'editor' }, icon: Code, key: 'e' },
  { id: 'logs', label: 'Logs', route: { name: 'logs' }, icon: ScrollText, key: 'l' },
  { id: 'metrics', label: 'Metrics', route: { name: 'metrics' }, icon: Activity, key: 'x' },
  { id: 'built', label: 'What you built', route: { name: 'built' }, icon: Trophy, key: 'b' },
];

/** A level screen belongs to the map; every other route marks its own link. */
export function isActive(item: NavItem, current: Route | null): boolean {
  if (current === null) return false;
  return (
    item.route.name === current.name || (item.route.name === 'home' && current.name === 'level')
  );
}
