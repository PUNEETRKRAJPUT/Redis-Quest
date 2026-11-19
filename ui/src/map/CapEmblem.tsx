'use client';

import { useId } from 'react';
import { emblemFor, shapePath } from './emblem';

const RIM = {
  gold: ['#FFE6B3', '#FFB347', '#9A5400'],
  silver: ['#FFFFFF', '#C3CCDD', '#55607F'],
} as const;

/** The field sits inside the rim at 80 percent: one outline drawn twice. */
const INNER = 'translate(32 32) scale(0.8) translate(-32 -32)';

function star(cx: number, cy: number, r: number): string {
  const pts: string[] = [];
  for (let i = 0; i < 10; i++) {
    const a = ((-90 + i * 36) * Math.PI) / 180;
    const rr = i % 2 === 0 ? r : r * 0.45;
    pts.push(`${(cx + rr * Math.cos(a)).toFixed(2)} ${(cy + rr * Math.sin(a)).toFixed(2)}`);
  }
  return `M${pts.join(' L')} Z`;
}

/**
 * An enamel pin drawn from the badge name: a metal rim, a glossy enamel field, a motif and stamped initials.
 * Decorative: the caller gives the name to screen readers.
 */
export function CapEmblem({ name, size = 64 }: { name: string; size?: number }) {
  const e = emblemFor(name);
  const uid = 'cap' + useId().replace(/[^a-zA-Z0-9_-]/g, '');
  const d = shapePath(e.shape);
  const [rimHi, rimMid, rimLo] = RIM[e.rim];
  const ty = e.shape === 'shield' ? 30 : 32.5;
  return (
    <svg
      viewBox="0 0 64 64"
      width={size}
      height={size}
      aria-hidden="true"
      focusable="false"
      className="overflow-visible"
    >
      <defs>
        <linearGradient id={`${uid}r`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor={rimHi} />
          <stop offset="0.45" stopColor={rimMid} />
          <stop offset="1" stopColor={rimLo} />
        </linearGradient>
        <radialGradient id={`${uid}f`} cx="0.36" cy="0.28" r="0.85">
          <stop offset="0" stopColor={e.enamel.hi} />
          <stop offset="1" stopColor={e.enamel.lo} />
        </radialGradient>
        <clipPath id={`${uid}c`}>
          <path d={d} transform={INNER} />
        </clipPath>
      </defs>
      {/* metal rim with a hairline edge */}
      <path d={d} fill={`url(#${uid}r)`} stroke="rgb(0 0 0 / 0.45)" strokeWidth="0.75" />
      {/* enamel field, set slightly into the metal */}
      <path d={d} transform={INNER} fill={`url(#${uid}f)`} stroke={rimLo} strokeWidth="1" />
      <g clipPath={`url(#${uid}c)`}>
        {e.motif === 'band' && (
          <rect
            x="-10"
            y="38"
            width="90"
            height="9"
            fill="rgb(255 255 255 / 0.16)"
            transform="rotate(-18 32 32)"
          />
        )}
        {e.motif === 'stars' && (
          <g fill={e.enamel.ink} opacity="0.5">
            <path d={star(21, 47, 3.2)} />
            <path d={star(32, 50, 3.2)} />
            <path d={star(43, 47, 3.2)} />
          </g>
        )}
        {e.motif === 'laurel' && (
          <g
            fill="none"
            stroke={e.enamel.ink}
            strokeOpacity="0.45"
            strokeWidth="1.6"
            strokeLinecap="round"
          >
            <path d="M17 26 C14 36 18 45 27 50" />
            <path d="M47 26 C50 36 46 45 37 50" />
            <path d="M16 33 l-3 -1 M17.5 40 l-3 0 M21 45.5 l-2.5 1.5" />
            <path d="M48 33 l3 -1 M46.5 40 l3 0 M43 45.5 l2.5 1.5" />
          </g>
        )}
        {/* glaze: a soft highlight across the top left */}
        <ellipse cx="24" cy="15" rx="26" ry="13" fill="rgb(255 255 255 / 0.2)" />
      </g>
      {/* stamped initials: a light lip under dark letters reads as pressed metal */}
      <text
        x="32"
        y={ty + 0.9}
        textAnchor="middle"
        dominantBaseline="central"
        fontSize={e.initials.length > 1 ? 20 : 25}
        fontWeight={700}
        fill="rgb(255 255 255 / 0.28)"
        style={{ fontFamily: 'var(--font-display)', letterSpacing: '0.5px' }}
      >
        {e.initials}
      </text>
      <text
        x="32"
        y={ty}
        textAnchor="middle"
        dominantBaseline="central"
        fontSize={e.initials.length > 1 ? 20 : 25}
        fontWeight={700}
        fill={e.enamel.ink}
        style={{ fontFamily: 'var(--font-display)', letterSpacing: '0.5px' }}
      >
        {e.initials}
      </text>
    </svg>
  );
}
