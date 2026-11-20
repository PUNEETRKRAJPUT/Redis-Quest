'use client';
// The commentary line for a moment, read once per moment so it does not change on every re-render.
import { useEffect, useState } from 'react';
import { useSettings } from '@/design/settings';
import type { Moment } from './lines';
import { commentaryLine } from './pick';

/** A line for `moment` while it is non-null, null when `moment` is null or the player turned commentary off. */
export function useCommentaryLine(moment: Moment | null): string | null {
  const setting = useSettings((s) => s.commentary);
  const [line, setLine] = useState<string | null>(null);
  useEffect(() => {
    setLine(moment ? commentaryLine(setting, moment) : null);
  }, [moment, setting]);
  return line;
}
