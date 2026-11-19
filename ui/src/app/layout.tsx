import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { fontClassNames } from '@/design/fonts';
// Legacy rules first, then Tailwind and the design tokens, so the tokens win where both set a variable.
import '../styles.css';
import './globals.css';

export const metadata: Metadata = {
  title: 'Redis Quest',
  description: 'A local, story-driven Redis learning game.',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={fontClassNames}>
      <body>{children}</body>
    </html>
  );
}
