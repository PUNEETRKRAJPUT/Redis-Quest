// Picks a commentary line for a moment. Lines rotate: a moment never repeats a line until it has used all of them,
// so the same verdict twice in a row reads differently. Pure except for the module-level picker the app shares.
import type { CommentarySetting } from '@/design/settings';
import { COMMENTARY, type LineTable, type Moment } from './lines';

export interface Picker {
  /** The next line for `moment`, or null when the table has none. */
  pick(moment: Moment): string | null;
}

/** `start` offsets where each moment's rotation begins (tests pass 0; the app passes a random number). */
export function createPicker(table: LineTable, start = 0): Picker {
  const used = new Map<Moment, number>();
  return {
    pick(moment) {
      const lines = table[moment];
      if (!lines || lines.length === 0) return null;
      const n = used.get(moment) ?? 0;
      used.set(moment, n + 1);
      return lines[(start + n) % lines.length] ?? null;
    },
  };
}

// The app's own pickers, created on first use so server render and tests never touch Math.random at import time.
const shared = new Map<'hinglish' | 'english', Picker>();

/** The next line for `moment` in the player's language, or null when commentary is off. */
export function commentaryLine(setting: CommentarySetting, moment: Moment): string | null {
  if (setting === 'off') return null;
  let picker = shared.get(setting);
  if (!picker) {
    picker = createPicker(COMMENTARY[setting], Math.floor(Math.random() * 1000));
    shared.set(setting, picker);
  }
  return picker.pick(moment);
}
