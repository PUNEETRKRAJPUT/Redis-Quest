/**
 * How well a palette entry matches what was typed, 0 (hidden) to 1. cmdk's own fuzzy scoring matches scattered
 * letters, so "hello" would also surface "keyboard shortcuts"; here a query has to appear as typed, or each of
 * its words has to appear somewhere in the title or its keywords.
 */
export function paletteScore(value: string, search: string, keywords: string[] = []): number {
  const q = search.trim().toLowerCase();
  if (!q) return 1;
  const v = value.toLowerCase();
  const at = v.indexOf(q);
  if (at === 0) return 1;
  if (at > 0) return /[\s\-_/·:]/.test(v.charAt(at - 1)) ? 0.9 : 0.6;
  const hay = `${v} ${keywords.join(' ').toLowerCase()}`;
  return q.split(/\s+/).every((w) => hay.includes(w)) ? 0.4 : 0;
}
