import type { ReactNode } from 'react';

// Inline SVG only (no emoji as UI icons). All icons are 20x20, stroke follows currentColor.
function Svg({ children, size = 18, title }: { children: ReactNode; size?: number; title?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" role={title ? 'img' : undefined} aria-label={title} aria-hidden={title ? undefined : true} focusable="false">
      {children}
    </svg>
  );
}
type P = { size?: number; title?: string };

export const IconLock = (p: P) => (
  <Svg {...p}>
    <rect x="4.5" y="9" width="11" height="7.5" rx="1.8" />
    <path d="M7 9V6.5a3 3 0 0 1 6 0V9" />
  </Svg>
);
export const IconCheck = (p: P) => (
  <Svg {...p}>
    <path d="M4.5 10.5l3.5 3.5 7.5-8" />
  </Svg>
);
export const IconPlay = (p: P) => (
  <Svg {...p}>
    <path d="M7 4.5l8 5.5-8 5.5z" />
  </Svg>
);
export const IconHalf = (p: P) => (
  <Svg {...p}>
    <circle cx="10" cy="10" r="6.5" />
    <path d="M10 3.5v13a6.5 6.5 0 0 0 0-13z" fill="currentColor" />
  </Svg>
);
export const IconChevron = (p: P) => (
  <Svg {...p}>
    <path d="M7.5 5l5 5-5 5" />
  </Svg>
);
export const IconTerminal = (p: P) => (
  <Svg {...p}>
    <rect x="2.5" y="4" width="15" height="12" rx="2" />
    <path d="M6 8.5l2.5 2L6 12.5M10.5 13h3.5" />
  </Svg>
);
export const IconCode = (p: P) => (
  <Svg {...p}>
    <path d="M7.5 6L3.5 10l4 4M12.5 6l4 4-4 4" />
  </Svg>
);
export const IconLog = (p: P) => (
  <Svg {...p}>
    <path d="M4 5h12M4 9h12M4 13h8" />
  </Svg>
);
export const IconPulse = (p: P) => (
  <Svg {...p}>
    <path d="M2.5 10h3l2-5 3.5 10 2-5h4.5" />
  </Svg>
);
export const IconMap = (p: P) => (
  <Svg {...p}>
    <path d="M3.5 5.5l4-1.5 5 1.5 4-1.5v10.5l-4 1.5-5-1.5-4 1.5z" />
    <path d="M7.5 4v10.5M12.5 5.5V16" />
  </Svg>
);
export const IconTrophy = (p: P) => (
  <Svg {...p}>
    <path d="M6 3.5h8v4a4 4 0 0 1-8 0zM6 5H3.5c0 2 1 3 2.7 3.3M14 5h2.5c0 2-1 3-2.7 3.3M10 11.5V15M7 16.5h6" />
  </Svg>
);
export const IconBulb = (p: P) => (
  <Svg {...p}>
    <path d="M7.5 14.5h5M8 17h4M10 3a5 5 0 0 0-3 9c.6.5 1 1.2 1 2h4c0-.8.4-1.5 1-2a5 5 0 0 0-3-9z" />
  </Svg>
);
export const IconWarn = (p: P) => (
  <Svg {...p}>
    <path d="M10 3.5l7 12.5H3z" />
    <path d="M10 8.5v3.5M10 14.2v.1" />
  </Svg>
);
export const IconCopy = (p: P) => (
  <Svg {...p}>
    <rect x="7" y="7" width="9" height="9" rx="1.8" />
    <path d="M13 7V5.5A1.5 1.5 0 0 0 11.5 4h-6A1.5 1.5 0 0 0 4 5.5v6A1.5 1.5 0 0 0 5.5 13H7" />
  </Svg>
);
export const IconExternal = (p: P) => (
  <Svg {...p}>
    <path d="M8 4.5H5a1.5 1.5 0 0 0-1.5 1.5v9A1.5 1.5 0 0 0 5 16.5h9a1.5 1.5 0 0 0 1.5-1.5v-3M11.5 3.5h5v5M16.5 3.5L9.5 10.5" />
  </Svg>
);
export const IconStar = (p: P) => (
  <Svg {...p}>
    <path d="M10 3l2.1 4.4 4.7.6-3.4 3.3.9 4.7L10 13.7 5.7 16l.9-4.7L3.2 8l4.7-.6z" />
  </Svg>
);
export const IconBall = (p: P) => (
  <Svg {...p}>
    <circle cx="10" cy="10" r="7" />
    <path d="M4.8 6.5c2 1.2 2 6.8 0 7M15.2 6.5c-2 1.2-2 6.8 0 7" />
  </Svg>
);
export const IconSpinner = (p: P) => (
  <svg className="spin" width={p.size ?? 16} height={p.size ?? 16} viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true" focusable="false">
    <path d="M10 3a7 7 0 1 0 7 7" />
  </svg>
);
