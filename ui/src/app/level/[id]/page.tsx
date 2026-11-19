import { Suspense } from 'react';
import { LevelRoute } from '@/shell/LevelRoute';

// The page renders inside GameShell, which shows only the boot state until the engine answers in the browser, so
// the page segment is never part of the prerender and instant-navigation validation cannot see it (dev-only check).
export const instant = false;

// Levels can be added after the build, so there is no generateStaticParams: params are request-time data, read
// inside Suspense by a client component. The level itself renders in the browser from the engine API.
export default function LevelPage({ params }: { params: Promise<{ id: string }> }) {
  return (
    <Suspense
      fallback={
        <div className="mx-auto max-w-[640px] px-4 py-6" aria-busy="true">
          <p className="text-md text-chalk-dim">Loading the level...</p>
        </div>
      }
    >
      <LevelRoute params={params} />
    </Suspense>
  );
}
