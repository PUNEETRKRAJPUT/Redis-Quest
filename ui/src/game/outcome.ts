import type { LevelStatus } from '../types';

/**
 * A level drawn as one ball of an over. The symbol is flavour; `label` always says it in plain words, so nobody
 * needs to know cricket scoring to read the map.
 */
export interface Ball {
  symbol: string;
  tone: 'six' | 'four' | 'run' | 'live' | 'next' | 'locked';
  label: string;
}

export function ballFor(status: LevelStatus, attempts: number): Ball {
  if (status === 'passed') {
    if (attempts <= 1) return { symbol: '6', tone: 'six', label: 'Passed first time' };
    if (attempts === 2) return { symbol: '4', tone: 'four', label: 'Passed on the second try' };
    return { symbol: '1', tone: 'run', label: `Passed in ${attempts} tries` };
  }
  if (status === 'in_progress') return { symbol: '', tone: 'live', label: 'In progress' };
  if (status === 'available') return { symbol: '', tone: 'next', label: 'Ready to play' };
  return { symbol: '', tone: 'locked', label: 'Locked' };
}
