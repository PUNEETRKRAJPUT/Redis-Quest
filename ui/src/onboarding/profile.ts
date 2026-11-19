// The player's cosmetic profile: a jersey colour. Persisted to localStorage, hydrated after mount (skipHydration)
// like the design settings, so server HTML and the first client render agree. Nothing here is game state.
import { create } from 'zustand';
import { createJSONStorage, persist, type StateStorage } from 'zustand/middleware';
import { browserStorage } from '../design/settings';

export const JERSEYS = [
  { id: 'flood', label: 'Floodlight amber', color: 'var(--color-flood-500)' },
  { id: 'turf', label: 'Turf green', color: 'var(--color-turf)' },
  { id: 'sky', label: 'Sky blue', color: 'var(--color-sky)' },
  { id: 'cap', label: 'Cap purple', color: 'var(--color-cap-purple)' },
  { id: 'wicket', label: 'Wicket red', color: 'var(--color-wicket)' },
  { id: 'chalk', label: 'Chalk white', color: 'var(--color-chalk)' },
] as const;

export type JerseyId = (typeof JERSEYS)[number]['id'];
export const DEFAULT_JERSEY: JerseyId = 'flood';
export const PROFILE_KEY = 'rq:profile';

export const isJerseyId = (v: unknown): v is JerseyId => JERSEYS.some((j) => j.id === v);
export const jerseyColor = (id: JerseyId): string =>
  (JERSEYS.find((j) => j.id === id) ?? JERSEYS[0]).color;

export type ProfileState = {
  jersey: JerseyId;
  setJersey: (jersey: JerseyId) => void;
};

export function createProfileStore(storage: () => StateStorage = browserStorage) {
  return create<ProfileState>()(
    persist(
      (set) => ({
        jersey: DEFAULT_JERSEY,
        setJersey: (jersey) => set({ jersey: isJerseyId(jersey) ? jersey : DEFAULT_JERSEY }),
      }),
      {
        name: PROFILE_KEY,
        version: 1,
        storage: createJSONStorage(storage),
        skipHydration: true,
        partialize: (s) => ({ jersey: s.jersey }),
        merge: (persisted, current) => {
          const p = (persisted ?? {}) as Partial<ProfileState>;
          return { ...current, jersey: isJerseyId(p.jersey) ? p.jersey : current.jersey };
        },
      },
    ),
  );
}

export const useProfile = createProfileStore();

/** Reads the saved profile into the store. Safe to call more than once. */
export function hydrateProfile(): Promise<void> | void {
  if (typeof window === 'undefined') return;
  return useProfile.persist.rehydrate();
}
