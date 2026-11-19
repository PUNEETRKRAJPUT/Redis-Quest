import { TerminalPanel } from '@/panels/TerminalPanel';

// The page renders inside GameShell, which shows only the boot state until the engine answers in the browser, so
// the page segment is never part of the prerender and instant-navigation validation cannot see it (dev-only check).
export const instant = false;

export default function TerminalPage() {
  return (
    <main data-ds="" className="mx-auto w-full max-w-[1100px] px-6 py-8">
      <h1 className="font-display text-2xl font-semibold uppercase tracking-display text-chalk">
        Terminal
      </h1>
      <p className="mb-5 mt-1 text-md text-chalk-dim">
        The same Redis your app uses. Dangerous commands get a warning, they are not blocked.
      </p>
      <TerminalPanel height={520} />
    </main>
  );
}
