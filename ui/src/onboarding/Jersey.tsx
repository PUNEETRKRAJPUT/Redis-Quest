// The jersey: a small SVG shirt in the chosen colour with the player's name printed on the back. Cosmetic only.
import { shirtName } from './scene';

export function Jersey({
  color,
  name,
  number = '07',
  className,
}: {
  color: string;
  name: string;
  number?: string;
  className?: string;
}) {
  const printed = shirtName(name);
  // Shrink the lettering so a long name still fits between the shoulders.
  const size = Math.max(7, Math.min(13, 78 / Math.max(printed.length, 1) / 0.62));
  return (
    <svg
      viewBox="0 0 120 132"
      className={className}
      role="img"
      aria-label={printed ? `Jersey number ${number}, ${printed}` : `Jersey number ${number}`}
    >
      <defs>
        <linearGradient id="rq-fabric" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#fff" stopOpacity="0.22" />
          <stop offset="0.5" stopColor="#fff" stopOpacity="0" />
          <stop offset="1" stopColor="#000" stopOpacity="0.28" />
        </linearGradient>
      </defs>
      <path
        d="M40 8 L22 16 L3 46 L23 58 L32 46 L32 122 L88 122 L88 46 L97 58 L117 46 L98 16 L80 8 Q60 26 40 8 Z"
        fill={color}
        style={{ transition: 'fill 220ms var(--ease-out-expo)' }}
      />
      <path
        d="M40 8 L22 16 L3 46 L23 58 L32 46 L32 122 L88 122 L88 46 L97 58 L117 46 L98 16 L80 8 Q60 26 40 8 Z"
        fill="url(#rq-fabric)"
      />
      <path d="M40 8 Q60 26 80 8" fill="none" stroke="rgb(7 10 18 / 0.55)" strokeWidth="3" />
      <path d="M9 40 L27 51 M111 40 L93 51" stroke="rgb(7 10 18 / 0.35)" strokeWidth="2.5" />
      {printed ? (
        <text
          x="60"
          y="48"
          textAnchor="middle"
          fill="rgb(7 10 18 / 0.82)"
          style={{
            fontFamily: 'var(--font-display)',
            fontWeight: 700,
            fontSize: size,
            letterSpacing: '0.08em',
          }}
        >
          {printed}
        </text>
      ) : null}
      <text
        x="60"
        y="96"
        textAnchor="middle"
        fill="rgb(7 10 18 / 0.82)"
        style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 40 }}
      >
        {number}
      </text>
    </svg>
  );
}
