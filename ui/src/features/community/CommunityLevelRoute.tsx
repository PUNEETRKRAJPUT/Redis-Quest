'use client';

import { use } from 'react';
import { CommunityLevel } from './CommunityLevel';

/** The community level page's client half: the id is request-time data, unwrapped here inside Suspense (like LevelRoute). */
export function CommunityLevelRoute({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  let levelId = id;
  try {
    levelId = decodeURIComponent(id);
  } catch {
    /* keep the raw segment */
  }
  return <CommunityLevel key={levelId} id={levelId} />;
}
