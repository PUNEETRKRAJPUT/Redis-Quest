// The commentary tables, typed. One JSON file per language so a line can be changed without touching code.
import english from './english.json';
import hinglish from './hinglish.json';
import { COMMENTARY_SETTINGS, type CommentarySetting } from '@/design/settings';

/** The moments a line can be picked for. */
export const MOMENTS = [
  'pass',
  'fail',
  'works_but_wrong',
  'chapter_done',
  'dangerous',
  'stack_down',
  'stack_back',
] as const;
export type Moment = (typeof MOMENTS)[number];

export type Language = Exclude<CommentarySetting, 'off'>;
export type LineTable = Record<Moment, readonly string[]>;

export const COMMENTARY: Record<Language, LineTable> = {
  hinglish: hinglish as LineTable,
  english: english as LineTable,
};

/** The moment a verdict is, or null when it has no commentary (the verifier is not installed). */
export function momentForVerdict(verdict: string | null): Moment | null {
  switch (verdict) {
    case 'right':
      return 'pass';
    case 'wrong':
      return 'fail';
    case 'works_but_wrong':
      return 'works_but_wrong';
    default:
      return null;
  }
}

export const COMMENTARY_LABEL: Record<CommentarySetting, string> = {
  hinglish: 'Hinglish',
  english: 'English',
  off: 'Off',
};

/** The palette item cycles Hinglish, English, off, and back. */
export function nextCommentary(current: CommentarySetting): CommentarySetting {
  const i = COMMENTARY_SETTINGS.indexOf(current);
  return COMMENTARY_SETTINGS[(i + 1) % COMMENTARY_SETTINGS.length] ?? 'hinglish';
}
