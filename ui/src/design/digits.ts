// Pure maths for FlipNumber and the gallery's contrast labels. No React, no DOM: unit-tested directly.

/**
 * The digits to show for a value, left-padded with zeros to `minDigits`. Negative values keep a leading "-".
 * Non-integers are rounded; non-finite values show as zeros.
 */
export function toDigits(value: number, minDigits = 1): string[] {
  const n = Number.isFinite(value) ? Math.round(value) : 0;
  const body = String(Math.abs(n)).padStart(Math.max(1, minDigits), '0');
  return n < 0 ? ['-', ...body.split('')] : body.split('');
}

/**
 * Pairs the previous and next digits right-aligned (units with units, tens with tens), so a cell keeps its key
 * when the number grows a digit. Returns one entry per next digit: its stable key (place from the right) and
 * whether it changed and so must flip.
 */
export function diffDigits(
  prev: string[],
  next: string[],
): Array<{ key: string; digit: string; changed: boolean }> {
  return next.map((digit, i) => {
    const place = next.length - 1 - i;
    const before = prev[prev.length - 1 - place];
    return { key: `p${place}`, digit, changed: before !== digit };
  });
}

/** Thousands separators for display next to (not inside) flip digits. */
export const groupThousands = (value: number): string => Math.round(value).toLocaleString('en-US');

/** WCAG 2.x relative luminance of #rrggbb. */
export function luminance(hex: string): number {
  const h = hex.replace('#', '');
  const ch = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255);
  const lin = ch.map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * (lin[0] ?? 0) + 0.7152 * (lin[1] ?? 0) + 0.0722 * (lin[2] ?? 0);
}

/** WCAG contrast ratio between two #rrggbb colours, 1..21. */
export function contrastRatio(a: string, b: string): number {
  const x = luminance(a);
  const y = luminance(b);
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}
