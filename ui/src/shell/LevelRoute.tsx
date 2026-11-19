'use client';

import { use } from 'react';
import { LevelScreen } from '../screens/Level';

/**
 * The level page's client half. The id is only known at request time, so the server page hands over the params
 * promise inside a Suspense boundary and this component unwraps it; nothing on the server reads the engine.
 */
export function LevelRoute({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const levelId = safeDecode(id);
  return <LevelScreen key={levelId} id={levelId} />;
}

function safeDecode(s: string): string {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}
