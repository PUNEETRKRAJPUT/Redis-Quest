import type { Metadata } from 'next';
import type { ReactNode } from 'react';
// Imported from its client module, not the '@/design' barrel: a server component must not pull hooks in.
import { DesignRuntime } from '@/design/components/feedback';
import { fontClassNames } from '@/design/fonts';
import { GameShell } from '@/shell/GameShell';
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
      <body>
        {/* Settings, toasts, confetti and floodlights for every screen: mounted once, around the game. */}
        <DesignRuntime>
          <GameShell>{children}</GameShell>
        </DesignRuntime>
      </body>
    </html>
  );
}
