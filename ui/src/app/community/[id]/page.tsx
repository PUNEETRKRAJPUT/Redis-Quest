import { Suspense } from 'react';
import { CommunityLevelRoute } from '@/features/community/CommunityLevelRoute';

// Same shape as app/level/[id]: no generateStaticParams (a community level can be added after the build), the params
// promise is read inside Suspense by a client component, and the level renders in the browser from the engine API.
export const instant = false;

export default function CommunityLevelPage({ params }: { params: Promise<{ id: string }> }) {
  return (
    <Suspense
      fallback={
        <div className="mx-auto max-w-[640px] px-4 py-6" aria-busy="true">
          <p className="text-md text-chalk-dim">Loading the level...</p>
        </div>
      }
    >
      <CommunityLevelRoute params={params} />
    </Suspense>
  );
}
