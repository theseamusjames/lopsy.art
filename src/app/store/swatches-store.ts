import { create } from 'zustand';

export interface Swatch {
  id: string;
  name: string;
  color: { r: number; g: number; b: number; a: number };
}

const STORAGE_KEY = 'lopsy:swatches';

const DEFAULT_SWATCHES: Swatch[] = [
  { id: 'default-black', name: 'Black', color: { r: 0, g: 0, b: 0, a: 1 } },
  { id: 'default-white', name: 'White', color: { r: 255, g: 255, b: 255, a: 1 } },
  { id: 'default-red', name: 'Red', color: { r: 220, g: 38, b: 38, a: 1 } },
  { id: 'default-orange', name: 'Orange', color: { r: 234, g: 88, b: 12, a: 1 } },
  { id: 'default-yellow', name: 'Yellow', color: { r: 234, g: 179, b: 8, a: 1 } },
  { id: 'default-green', name: 'Green', color: { r: 22, g: 163, b: 74, a: 1 } },
  { id: 'default-cyan', name: 'Cyan', color: { r: 6, g: 182, b: 212, a: 1 } },
  { id: 'default-blue', name: 'Blue', color: { r: 37, g: 99, b: 235, a: 1 } },
  { id: 'default-violet', name: 'Violet', color: { r: 124, g: 58, b: 237, a: 1 } },
  { id: 'default-pink', name: 'Pink', color: { r: 219, g: 39, b: 119, a: 1 } },
  { id: 'default-gray-dark', name: 'Dark Gray', color: { r: 75, g: 85, b: 99, a: 1 } },
  { id: 'default-gray-light', name: 'Light Gray', color: { r: 156, g: 163, b: 175, a: 1 } },
];

function loadSwatches(): Swatch[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_SWATCHES;
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return DEFAULT_SWATCHES;
    return parsed as Swatch[];
  } catch {
    return DEFAULT_SWATCHES;
  }
}

function saveSwatches(swatches: Swatch[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(swatches));
  } catch {
    // localStorage may be unavailable (private mode, quota exceeded)
  }
}

interface SwatchesState {
  swatches: Swatch[];
  addSwatch: (color: { r: number; g: number; b: number; a: number }, name?: string) => void;
  removeSwatch: (id: string) => void;
  renameSwatch: (id: string, name: string) => void;
  clearSwatches: () => void;
}

export const useSwatchesStore = create<SwatchesState>((set) => ({
  swatches: loadSwatches(),

  addSwatch: (color, name) => {
    const id = crypto.randomUUID();
    const swatchName = name ?? `Swatch ${Math.floor(Math.random() * 9000) + 1000}`;
    set((state) => {
      const next = [...state.swatches, { id, name: swatchName, color }];
      saveSwatches(next);
      return { swatches: next };
    });
  },

  removeSwatch: (id) => {
    set((state) => {
      const next = state.swatches.filter((s) => s.id !== id);
      saveSwatches(next);
      return { swatches: next };
    });
  },

  renameSwatch: (id, name) => {
    set((state) => {
      const next = state.swatches.map((s) => (s.id === id ? { ...s, name } : s));
      saveSwatches(next);
      return { swatches: next };
    });
  },

  clearSwatches: () => {
    saveSwatches([]);
    set({ swatches: [] });
  },
}));
