'use client';

import { clsx } from 'clsx';
import { memo } from 'react';
import s from './map.module.css';

/** A tiny seeded generator, so the stars and windows sit in the same place on every render. */
function seeded(seed: number) {
  let x = seed >>> 0;
  return () => {
    x = (Math.imul(x, 1664525) + 1013904223) >>> 0;
    return x / 0x100000000;
  };
}

const W = 1200;
const H = 720;

const rnd = seeded(19);
const STARS = Array.from({ length: 80 }, () => ({
  x: Math.round(rnd() * W),
  y: Math.round(rnd() * H * 0.42),
  r: rnd() < 0.15 ? 1.4 : 0.8,
  delay: Math.round(rnd() * 4500),
  twinkle: rnd() < 0.3,
}));

/** Hostel blocks along the horizon: x, width, height. Windows are lit by the same seed. */
const BLOCKS: [number, number, number][] = [
  [0, 120, 70],
  [130, 90, 100],
  [230, 140, 60],
  [380, 70, 120],
  [800, 80, 110],
  [890, 150, 70],
  [1050, 70, 95],
  [1125, 75, 60],
];
const wr = seeded(7);
const WINDOWS = BLOCKS.flatMap(([bx, bw, bh]) => {
  const out: { x: number; y: number; on: boolean }[] = [];
  for (let y = H - bh + 12; y < H - 10; y += 14)
    for (let x = bx + 10; x < bx + bw - 10; x += 16) out.push({ x, y, on: wr() < 0.28 });
  return out;
});

/** Two floodlight pylons in the top corners, each throwing two beams: a steep one and a long one. */
const PYLONS = [
  { x: 30, top: 34, lean: 1 },
  { x: 1170, top: 34, lean: -1 },
];
/** Beam order as the season lights up: left steep, right steep, left long, right long. */
const BEAMS = [
  { pylon: 0, near: 60, far: 430 },
  { pylon: 1, near: 60, far: 430 },
  { pylon: 0, near: 380, far: 900 },
  { pylon: 1, near: 380, far: 900 },
];

/**
 * The night campus behind the season path: sky, stars, the hostel skyline, the ground and four floodlight pylons.
 * `lit` (0 to 4) is how many beams are on: the campus lights up as the season goes on. Pure SVG, scales crisp.
 */
export const CampusScene = memo(function CampusScene({ lit }: { lit: number }) {
  return (
    <svg
      aria-hidden="true"
      focusable="false"
      viewBox={`0 0 ${W} ${H}`}
      preserveAspectRatio="xMidYMax slice"
      className="pointer-events-none absolute inset-0 size-full"
    >
      <defs>
        <linearGradient id="cs-sky" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#070A12" />
          <stop offset="0.55" stopColor="#0B1226" />
          <stop offset="1" stopColor="#0D1530" />
        </linearGradient>
        <radialGradient id="cs-ground" cx="0.5" cy="0.1" r="0.7">
          <stop offset="0" stopColor="#123526" stopOpacity="0.55" />
          <stop offset="1" stopColor="#0B1020" stopOpacity="0" />
        </radialGradient>
        <linearGradient id="cs-beam" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#FFB347" stopOpacity="0.2" />
          <stop offset="1" stopColor="#FF9A1F" stopOpacity="0" />
        </linearGradient>
        <radialGradient id="cs-halo" cx="0.5" cy="0.5" r="0.5">
          <stop offset="0" stopColor="#FFD08A" stopOpacity="0.9" />
          <stop offset="0.35" stopColor="#FF9A1F" stopOpacity="0.35" />
          <stop offset="1" stopColor="#FF9A1F" stopOpacity="0" />
        </radialGradient>
      </defs>

      <rect width={W} height={H} fill="url(#cs-sky)" />

      {STARS.map((st, i) => (
        <circle
          key={i}
          cx={st.x}
          cy={st.y}
          r={st.r}
          fill="#EEF2FA"
          opacity={st.twinkle ? undefined : 0.35}
          className={st.twinkle ? clsx('ds-still', s.twinkle) : undefined}
          style={st.twinkle ? { animationDelay: `${st.delay}ms` } : undefined}
        />
      ))}

      {/* the ground: a wide oval of grass with the pitch strip in the middle */}
      <ellipse cx={W / 2} cy={H * 0.78} rx={W * 0.62} ry={H * 0.34} fill="url(#cs-ground)" />
      <ellipse
        cx={W / 2}
        cy={H * 0.74}
        rx={W * 0.4}
        ry={H * 0.2}
        fill="none"
        stroke="#EEF2FA"
        strokeOpacity="0.05"
        strokeWidth="2"
        strokeDasharray="2 10"
      />

      {/* beams first, so the pylons sit on top of their own light */}
      {BEAMS.map((b, i) => {
        if (i >= lit) return null;
        const p = PYLONS[b.pylon]!;
        return (
          <polygon
            key={`b${i}`}
            points={`${p.x - 10},${p.top} ${p.x + 10},${p.top} ${p.x + p.lean * b.far},${H} ${p.x + p.lean * b.near},${H}`}
            fill="url(#cs-beam)"
          />
        );
      })}

      {/* hostel skyline */}
      {BLOCKS.map(([bx, bw, bh], i) => (
        <rect key={`k${i}`} x={bx} y={H - bh} width={bw} height={bh} fill="#080C18" />
      ))}
      {WINDOWS.map((w, i) =>
        w.on ? (
          <rect key={`w${i}`} x={w.x} y={w.y} width="5" height="6" fill="#FFB347" opacity="0.4" />
        ) : null,
      )}

      {/* pylons: a lattice mast and a tilted head of lamps; a halo when any of its beams is on */}
      {PYLONS.map((p, i) => {
        const on = BEAMS.some((b, bi) => b.pylon === i && bi < lit);
        return (
          <g key={`p${i}`}>
            <path
              d={`M${p.x - 3} ${p.top + 12} L${p.x - 9} ${H} M${p.x + 3} ${p.top + 12} L${p.x + 9} ${H}`}
              stroke="#1A2344"
              strokeWidth="2.5"
            />
            <g transform={`rotate(${p.lean * 14} ${p.x} ${p.top})`}>
              <rect
                x={p.x - 22}
                y={p.top - 12}
                width="44"
                height="24"
                rx="3"
                fill="#111833"
                stroke="#27325C"
              />
              {[0, 1, 2, 3].map((c) =>
                [0, 1].map((r) => (
                  <rect
                    key={`${c}${r}`}
                    x={p.x - 18 + c * 9.5}
                    y={p.top - 8 + r * 9}
                    width="7"
                    height="7"
                    rx="1.5"
                    fill={on ? '#FFE2A8' : '#1A2344'}
                  />
                )),
              )}
            </g>
            {on && (
              <circle
                cx={p.x}
                cy={p.top}
                r="80"
                fill="url(#cs-halo)"
                className={clsx('ds-still', s.breathe)}
                style={{ animationDelay: `${i * 900}ms` }}
              />
            )}
          </g>
        );
      })}
    </svg>
  );
});
