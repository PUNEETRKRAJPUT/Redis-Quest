// Player preferences for the design layer: sound and motion. A zustand store persisted to localStorage, guarded so
// it imports cleanly during server render and under vitest. Persistence hydrates after mount (skipHydration), so the
// server HTML and the first client render agree; DesignRuntime calls `hydrateSettings()` once on mount.
import { create } from 'zustand';
import { createJSONStorage, persist, type StateStorage } from 'zustand/middleware';

export type ReducedMotionSetting = 'system' | 'on' | 'off';

export type SettingsState = {
  /** Off until the player turns it on (the brief: onboarding asks once). */
  sound: boolean;
  /** 0..1, applied on top of a quiet master level. */
  volume: number;
  /** `system` follows the OS, `on` always reduces, `off` always animates. */
  reducedMotion: ReducedMotionSetting;
  setSound: (sound: boolean) => void;
  toggleSound: () => void;
  setVolume: (volume: number) => void;
  setReducedMotion: (value: ReducedMotionSetting) => void;
};

export const SETTINGS_KEY = 'rq:settings';
export const DEFAULT_SETTINGS = {
  sound: false,
  volume: 0.6,
  reducedMotion: 'system' as ReducedMotionSetting,
};

const memory = (): StateStorage => {
  const m = new Map<string, string>();
  return {
    getItem: (k) => m.get(k) ?? null,
    setItem: (k, v) => void m.set(k, v),
    removeItem: (k) => void m.delete(k),
  };
};

/** localStorage when it exists and works (it can throw in private modes), an in-memory map otherwise. */
export function browserStorage(): StateStorage {
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      const probe = '__rq_probe__';
      window.localStorage.setItem(probe, '1');
      window.localStorage.removeItem(probe);
      return window.localStorage;
    }
  } catch {
    // fall through to memory
  }
  return memory();
}

export const clampVolume = (v: number) =>
  Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : DEFAULT_SETTINGS.volume;

/** Builds a settings store over any storage; the app uses one instance, tests make their own. */
export function createSettingsStore(storage: () => StateStorage = browserStorage) {
  return create<SettingsState>()(
    persist(
      (set) => ({
        ...DEFAULT_SETTINGS,
        setSound: (sound) => set({ sound }),
        toggleSound: () => set((s) => ({ sound: !s.sound })),
        setVolume: (volume) => set({ volume: clampVolume(volume) }),
        setReducedMotion: (reducedMotion) => set({ reducedMotion }),
      }),
      {
        name: SETTINGS_KEY,
        version: 1,
        storage: createJSONStorage(storage),
        skipHydration: true,
        partialize: (s) => ({ sound: s.sound, volume: s.volume, reducedMotion: s.reducedMotion }),
        merge: (persisted, current) => {
          const p = (persisted ?? {}) as Partial<SettingsState>;
          return {
            ...current,
            sound: typeof p.sound === 'boolean' ? p.sound : current.sound,
            volume: typeof p.volume === 'number' ? clampVolume(p.volume) : current.volume,
            reducedMotion:
              p.reducedMotion === 'on' || p.reducedMotion === 'off' || p.reducedMotion === 'system'
                ? p.reducedMotion
                : current.reducedMotion,
          };
        },
      },
    ),
  );
}

export const useSettings = createSettingsStore();

/** Reads the persisted settings into the store. Safe to call more than once. */
export function hydrateSettings(): Promise<void> | void {
  if (typeof window === 'undefined') return;
  return useSettings.persist.rehydrate();
}

/** Pure: the in-game setting wins; `system` defers to the OS media query. */
export function resolveReducedMotion(
  setting: ReducedMotionSetting,
  osPrefersReduced: boolean,
): boolean {
  if (setting === 'on') return true;
  if (setting === 'off') return false;
  return osPrefersReduced;
}
