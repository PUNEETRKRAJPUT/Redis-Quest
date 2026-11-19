// Hand-rolled list windowing for the log feed: fixed row height, absolute rows inside one spacer. A thousand
// lines at several per second must not re-layout the whole list, so only the rows in view (plus a few) exist.

export interface WindowRange {
  start: number;
  /** Exclusive. */
  end: number;
}

export function visibleRange(
  scrollTop: number,
  viewport: number,
  rowHeight: number,
  count: number,
  overscan = 8,
): WindowRange {
  if (count <= 0 || rowHeight <= 0) return { start: 0, end: 0 };
  const first = Math.floor(Math.max(0, scrollTop) / rowHeight);
  const last = Math.ceil((Math.max(0, scrollTop) + Math.max(0, viewport)) / rowHeight);
  return {
    start: Math.max(0, Math.min(count, first - overscan)),
    end: Math.max(0, Math.min(count, last + overscan)),
  };
}

/** The scrollTop that shows the last row at the bottom edge. */
export function bottomOffset(count: number, viewport: number, rowHeight: number): number {
  return Math.max(0, count * rowHeight - viewport);
}

/** Within `slack` pixels of the bottom. */
export function isAtBottom(
  scrollTop: number,
  viewport: number,
  total: number,
  slack = 24,
): boolean {
  return total - scrollTop - viewport <= slack;
}
