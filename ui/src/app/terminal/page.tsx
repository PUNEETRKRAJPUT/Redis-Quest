import { TerminalPanel } from '@/panels/TerminalPanel';

// The page renders inside GameShell, which shows only the boot state until the engine answers in the browser, so
// the page segment is never part of the prerender and instant-navigation validation cannot see it (dev-only check).
export const instant = false;

export default function TerminalPage() {
  return (
    <main className="page">
      <h1>Terminal</h1>
      <p className="muted">
        The same Redis your app uses. Dangerous commands get a warning, they are not blocked.
      </p>
      <TerminalPanel height={520} />
    </main>
  );
}
