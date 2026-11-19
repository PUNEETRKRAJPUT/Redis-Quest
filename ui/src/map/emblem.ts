// Enamel-cap emblems generated from the badge name alone, so no badge ever needs hand-drawn art. The same name
// always gives the same cap: shape, enamel colour, metal rim, motif and initials all come from one hash.

export type EmblemShape = 'round' | 'shield' | 'hex' | 'rosette' | 'octagon' | 'crest';
export type EmblemMotif = 'plain' | 'band' | 'stars' | 'laurel';

export interface Enamel {
  id: string;
  /** Light and dark stops of the enamel field. */
  hi: string;
  lo: string;
  /** Initials colour on this enamel. */
  ink: string;
}

export interface Emblem {
  shape: EmblemShape;
  enamel: Enamel;
  /** The metal rim: gold (flood) or silver (chalk). */
  rim: 'gold' | 'silver';
  motif: EmblemMotif;
  initials: string;
}

export const SHAPES: readonly EmblemShape[] = [
  'round',
  'shield',
  'hex',
  'rosette',
  'octagon',
  'crest',
];
export const MOTIFS: readonly EmblemMotif[] = ['plain', 'band', 'stars', 'laurel'];

/** Enamel colours, all from the "Night match" palette. */
export const ENAMELS: readonly Enamel[] = [
  { id: 'flood', hi: '#FFB347', lo: '#E67E00', ink: '#1A1206' },
  { id: 'turf', hi: '#5BF0A0', lo: '#1FB86A', ink: '#070A12' },
  { id: 'sky', hi: '#8AD8FF', lo: '#2F9FDC', ink: '#070A12' },
  { id: 'cap', hi: '#CBADFF', lo: '#8C63E0', ink: '#070A12' },
  { id: 'wicket', hi: '#FF7A8A', lo: '#D93A50', ink: '#070A12' },
  { id: 'night', hi: '#27325C', lo: '#111833', ink: '#FFB347' },
  { id: 'chalk', hi: '#FFFFFF', lo: '#A9B4CC', ink: '#0B1020' },
];

const SMALL_WORDS = new Set(['a', 'an', 'and', 'at', 'for', 'in', 'of', 'on', 'or', 'the', 'to']);

/** FNV-1a, 32 bit: small, stable across runs and engines. */
export function hashName(name: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < name.length; i++) {
    h ^= name.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** One or two initials: the first letters of the first two meaningful words ("Fresh on write" gives FW). */
export function initialsFor(name: string): string {
  const words = name
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean)
    .filter((w, i, all) => all.length === 1 || i === 0 || !SMALL_WORDS.has(w.toLowerCase()));
  if (words.length === 0) return '?';
  return words
    .slice(0, 2)
    .map((w) => [...w][0]!.toUpperCase())
    .join('');
}

export function emblemFor(name: string): Emblem {
  const h = hashName(name);
  const enamel = ENAMELS[h % ENAMELS.length]!;
  // Each part reads different bits of the hash so they vary independently.
  const shape = SHAPES[(h >>> 5) % SHAPES.length]!;
  const motif = MOTIFS[(h >>> 11) % MOTIFS.length]!;
  // Gold on gold reads as one blob: amber enamel always gets a silver rim.
  const rim = enamel.id === 'flood' ? 'silver' : (h >>> 17) % 3 === 0 ? 'silver' : 'gold';
  return { shape, enamel, rim, motif, initials: initialsFor(name) };
}

/** The outline of each shape in a 64x64 box centred on (32, 32). */
export function shapePath(shape: EmblemShape): string {
  switch (shape) {
    case 'round':
      return 'M32 3a29 29 0 1 1 0 58a29 29 0 1 1 0-58Z';
    case 'shield':
      return 'M32 3 L56 10 C56 34 50 50 32 61 C14 50 8 34 8 10 Z';
    case 'hex':
      return polygon(6, 29, -90);
    case 'octagon':
      return polygon(8, 29.5, -67.5);
    case 'crest':
      return 'M18 4 H46 A14 14 0 0 1 60 18 V46 A14 14 0 0 1 46 60 H18 A14 14 0 0 1 4 46 V18 A14 14 0 0 1 18 4 Z';
    case 'rosette':
      return rosette(12, 26.5, 30.5);
  }
}

const r2 = (n: number) => Math.round(n * 100) / 100;

function polygon(sides: number, r: number, startDeg: number): string {
  const pts = Array.from({ length: sides }, (_, i) => {
    const a = ((startDeg + (360 / sides) * i) * Math.PI) / 180;
    return `${r2(32 + r * Math.cos(a))} ${r2(32 + r * Math.sin(a))}`;
  });
  return `M${pts.join(' L')} Z`;
}

/** A scalloped edge: points on an inner circle joined by curves bulging out to the outer radius. */
function rosette(bumps: number, inner: number, outer: number): string {
  const at = (deg: number, r: number) => {
    const a = (deg * Math.PI) / 180;
    return `${r2(32 + r * Math.cos(a))} ${r2(32 + r * Math.sin(a))}`;
  };
  const step = 360 / bumps;
  let d = `M${at(-90, inner)}`;
  for (let i = 0; i < bumps; i++) {
    const a = -90 + step * i;
    d += ` Q${at(a + step / 2, outer + 3)} ${at(a + step, inner)}`;
  }
  return `${d} Z`;
}
