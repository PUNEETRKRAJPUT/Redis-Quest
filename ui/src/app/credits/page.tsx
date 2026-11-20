import { Credits } from '@/features/credits/Credits';

// The page renders inside GameShell, which shows only the boot state until the engine answers in the browser, so
// the page segment is never part of the prerender and instant-navigation validation cannot see it (dev-only check).
export const instant = false;

export default function CreditsPage() {
  return <Credits />;
}
