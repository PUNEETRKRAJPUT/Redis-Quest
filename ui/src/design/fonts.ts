// Self-hosted fonts from the installed @fontsource packages (Latin subset only, no font CDN, no build-time
// network). next/font/local resolves `src` relative to this file and emits same-origin font files. The layout puts
// `fontClassNames` on <html>, which declares the three CSS variables tokens.css builds the font stacks from.
import localFont from 'next/font/local';

const barlowCondensed = localFont({
  src: [
    {
      path: '../../node_modules/@fontsource/barlow-condensed/files/barlow-condensed-latin-500-normal.woff2',
      weight: '500',
      style: 'normal',
    },
    {
      path: '../../node_modules/@fontsource/barlow-condensed/files/barlow-condensed-latin-600-normal.woff2',
      weight: '600',
      style: 'normal',
    },
    {
      path: '../../node_modules/@fontsource/barlow-condensed/files/barlow-condensed-latin-700-normal.woff2',
      weight: '700',
      style: 'normal',
    },
  ],
  variable: '--font-barlow-condensed',
  display: 'swap',
  fallback: ['Arial Narrow', 'sans-serif'],
});

const inter = localFont({
  src: '../../node_modules/@fontsource-variable/inter/files/inter-latin-wght-normal.woff2',
  weight: '100 900',
  style: 'normal',
  variable: '--font-inter',
  display: 'swap',
  fallback: ['system-ui', 'sans-serif'],
});

const jetbrainsMono = localFont({
  src: '../../node_modules/@fontsource-variable/jetbrains-mono/files/jetbrains-mono-latin-wght-normal.woff2',
  weight: '100 800',
  style: 'normal',
  variable: '--font-jetbrains-mono',
  display: 'swap',
  fallback: ['ui-monospace', 'Menlo', 'monospace'],
  adjustFontFallback: false,
});

export const fontClassNames = [
  barlowCondensed.variable,
  inter.variable,
  jetbrainsMono.variable,
].join(' ');
