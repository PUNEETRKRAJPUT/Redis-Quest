import { useId } from 'react';

/**
 * The player's shirt, seen from behind: the name across the shoulders and the number of levels passed, like the
 * back of a real kit. `color` is any CSS colour (the jersey store gives a design-token variable).
 */
export function Jersey({
  color,
  name,
  number,
  size = 150,
}: {
  color: string;
  name: string;
  number: number;
  size?: number;
}) {
  const id = useId();
  const label = name.trim().slice(0, 10).toUpperCase() || 'PLAYER';
  return (
    <svg
      viewBox="0 0 160 172"
      width={size}
      height={(size * 172) / 160}
      role="img"
      aria-label={`${name}'s jersey, number ${number}`}
      className="shrink-0 drop-shadow-[0_18px_24px_rgb(0_0_0/0.55)]"
    >
      <defs>
        <linearGradient id={`${id}-body`} x1="0" x2="0" y1="0" y2="1">
          <stop offset="0" stopColor="white" stopOpacity="0.28" />
          <stop offset="0.35" stopColor="white" stopOpacity="0" />
          <stop offset="1" stopColor="black" stopOpacity="0.38" />
        </linearGradient>
      </defs>
      <path
        d="M52 12 L20 28 L3 72 L31 85 L41 64 L41 158 Q41 164 47 164 L113 164 Q119 164 119 158 L119 64 L129 85 L157 72 L140 28 L108 12 Q80 38 52 12 Z"
        style={{ fill: color }}
      />
      <path
        d="M52 12 L20 28 L3 72 L31 85 L41 64 L41 158 Q41 164 47 164 L113 164 Q119 164 119 158 L119 64 L129 85 L157 72 L140 28 L108 12 Q80 38 52 12 Z"
        fill={`url(#${id}-body)`}
      />
      {/* sleeve trim and collar */}
      <path
        d="M5 66 L33 79"
        stroke="#0B1020"
        strokeOpacity="0.55"
        strokeWidth="4"
        strokeLinecap="round"
      />
      <path
        d="M155 66 L127 79"
        stroke="#0B1020"
        strokeOpacity="0.55"
        strokeWidth="4"
        strokeLinecap="round"
      />
      <path
        d="M52 12 Q80 38 108 12"
        fill="none"
        stroke="#0B1020"
        strokeOpacity="0.7"
        strokeWidth="5"
        strokeLinecap="round"
      />
      <text
        x="80"
        y="66"
        textAnchor="middle"
        fill="#0B1020"
        fillOpacity="0.88"
        fontFamily="var(--font-display)"
        fontWeight="700"
        fontSize={label.length > 7 ? 13 : 16}
        letterSpacing="2"
      >
        {label}
      </text>
      <text
        x="80"
        y="128"
        textAnchor="middle"
        fill="#0B1020"
        fillOpacity="0.88"
        fontFamily="var(--font-display)"
        fontWeight="700"
        fontSize={number >= 100 ? 50 : 62}
      >
        {number}
      </text>
    </svg>
  );
}
