'use client';

import { useSyncExternalStore } from 'react';
import { docsStore } from './docs';

/** Re-renders when names or docs arrive; the store itself is the session cache. */
export function useDocsVersion(): number {
  const store = docsStore();
  return useSyncExternalStore(store.subscribe, store.version, () => 0);
}
