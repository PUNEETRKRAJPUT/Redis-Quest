'use client';
// The set for the opening scene: a night pitch under four floodlight pylons, with rain in the beams. Purely
// decorative (aria-hidden). `lit` turns the lamps on; under reduced motion the CSS module drops every animation.
import { clsx } from 'clsx';
import './stage.css';

// Deterministic streaks so the server and the first client render agree (no Math.random in render).
function mulberry32(seed: number) {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const TILE = 300;
function streaks(seed: number, count: number, len: [number, number]) {
  const r = mulberry32(seed);
  return Array.from({ length: count }, () => {
    const l = len[0] + r() * (len[1] - len[0]);
    const x = 4 + r() * (TILE - 30);
    const y = r() * (TILE - l - 2);
    const dx = l * 0.2;
    return { x1: x, y1: y, x2: x + dx, y2: y + l, o: 0.25 + r() * 0.5 };
  });
}
const NEAR = streaks(7, 26, [34, 70]);
const FAR = streaks(19, 34, [18, 36]);

function RainLayer({
  id,
  lines,
  className,
}: {
  id: string;
  lines: typeof NEAR;
  className: string;
}) {
  return (
    <svg className={clsx('rqw-rain-layer', className)} width="100%" height="100%" focusable="false">
      <defs>
        <pattern id={id} width={TILE} height={TILE} patternUnits="userSpaceOnUse">
          {lines.map((s, i) => (
            <line
              key={i}
              x1={s.x1}
              y1={s.y1}
              x2={s.x2}
              y2={s.y2}
              stroke="rgb(214 228 255)"
              strokeOpacity={s.o * 0.55}
              strokeWidth="1"
              strokeLinecap="round"
            />
          ))}
        </pattern>
      </defs>
      <rect width="100%" height="100%" fill={`url(#${id})`} />
    </svg>
  );
}

const RIGS = [
  { x: '7%', aim: 20, small: false },
  { x: '27%', aim: 9, small: true },
  { x: '73%', aim: -9, small: true },
  { x: '93%', aim: -20, small: false },
];

export function Stage({ lit }: { lit: boolean }) {
  return (
    <div aria-hidden className={clsx('rqw-stage', lit && 'rqw-lit')}>
      <div className="rqw-pitch" />
      <div className="rqw-glow" />
      {RIGS.map((r) => (
        <div
          key={r.x}
          className={clsx('rqw-beam', r.small && 'rqw-beam-inner')}
          style={{ left: r.x, rotate: `${r.aim}deg` }}
        />
      ))}
      <div className="rqw-rain">
        <RainLayer id="rq-rain-far" lines={FAR} className="rqw-rain-far" />
        <RainLayer id="rq-rain-near" lines={NEAR} className="" />
      </div>
      {RIGS.map((r) => (
        <div
          key={r.x}
          className={clsx('rqw-rig', r.small && 'rqw-rig-small')}
          style={{ left: r.x }}
        >
          {Array.from({ length: 9 }, (_, i) => (
            <span
              key={i}
              className="rqw-lamp"
              style={{ ['--d' as string]: `${(i * 97 + (r.small ? 130 : 0)) % 420}ms` }}
            />
          ))}
        </div>
      ))}
      <div className="rqw-vignette" />
    </div>
  );
}
