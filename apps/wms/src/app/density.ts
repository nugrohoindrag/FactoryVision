import { useEffect, useSyncExternalStore } from 'react';
import { create } from 'zustand';
import { persist } from 'zustand/middleware';

/**
 * Density (UI Spec D2, DS §3).
 *
 * Density follows the INPUT METHOD, not the screen width. A touchscreen PC
 * gets `touch`; a tablet with a mouse gets `compact`. Deciding by width is
 * how tablets end up with 40px rows that a gloved hand cannot hit.
 *
 * The user can always override — the detection is a default, not a verdict.
 */

export type Density = 'touch' | 'compact';
export type DensityPreference = Density | 'auto';

const COARSE_QUERY = '(pointer: coarse)';

function subscribeToPointer(callback: () => void) {
  if (typeof window === 'undefined' || !window.matchMedia) return () => {};
  const mql = window.matchMedia(COARSE_QUERY);
  mql.addEventListener('change', callback);
  return () => mql.removeEventListener('change', callback);
}

function isCoarsePointer() {
  if (typeof window === 'undefined' || !window.matchMedia) return false;
  return window.matchMedia(COARSE_QUERY).matches;
}

interface DensityState {
  preference: DensityPreference;
  setPreference: (preference: DensityPreference) => void;
}

export const useDensityPreference = create<DensityState>()(
  persist(
    (set) => ({
      preference: 'auto',
      setPreference: (preference) => set({ preference }),
    }),
    { name: 'fv.density' },
  ),
);

/** The density in effect right now, resolving `auto` against the pointer. */
export function useDensity(): Density {
  const preference = useDensityPreference((s) => s.preference);
  const coarse = useSyncExternalStore(subscribeToPointer, isCoarsePointer, () => true);
  return preference === 'auto' ? (coarse ? 'touch' : 'compact') : preference;
}

/** Writes `[data-density]` on <html>, where the size tokens are keyed off it. */
export function useApplyDensity(): Density {
  const density = useDensity();
  useEffect(() => {
    document.documentElement.dataset.density = density;
  }, [density]);
  return density;
}
