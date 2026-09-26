import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import {
  DEFAULT_SWATCHES,
  addSwatches,
  removeSwatchAt,
  sanitizeSwatches,
} from '../panels/SwatchesPanel/swatches';
import type { Swatch } from '../panels/SwatchesPanel/swatches';

export const SWATCHES_STORAGE_KEY = 'lopsy-swatches';

interface SwatchesState {
  swatches: readonly Swatch[];
  /** Appends swatches, skipping duplicates. Returns how many were added. */
  addSwatches: (incoming: readonly Swatch[]) => number;
  removeSwatch: (index: number) => void;
  resetSwatches: () => void;
}

export const useSwatchesStore = create<SwatchesState>()(
  persist(
    (set, get) => ({
      swatches: DEFAULT_SWATCHES,

      addSwatches: (incoming) => {
        const before = get().swatches;
        const next = addSwatches(before, incoming);
        if (next !== before) set({ swatches: next });
        return next.length - before.length;
      },

      removeSwatch: (index) => set((s) => ({ swatches: removeSwatchAt(s.swatches, index) })),

      resetSwatches: () => set({ swatches: DEFAULT_SWATCHES }),
    }),
    {
      name: SWATCHES_STORAGE_KEY,
      version: 1,
      partialize: (s) => ({ swatches: s.swatches }),
      // Persisted data is untrusted — keep only well-formed entries and fall
      // back to the defaults when the payload isn't a list at all.
      merge: (persisted, current) => {
        const raw = (persisted as { swatches?: unknown } | undefined)?.swatches;
        const swatches = sanitizeSwatches(raw);
        return swatches ? { ...current, swatches } : current;
      },
    },
  ),
);
