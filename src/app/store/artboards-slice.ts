import type { Artboard } from '../../types/document';
import type { SliceCreator } from './types';

export interface ArtboardsSlice {
  artboards: readonly Artboard[];
  addArtboard: (artboard: Omit<Artboard, 'id'>) => void;
  removeArtboard: (id: string) => void;
  updateArtboard: (id: string, update: Partial<Omit<Artboard, 'id'>>) => void;
  renameArtboard: (id: string, name: string) => void;
}

export const createArtboardsSlice: SliceCreator<ArtboardsSlice> = (set, _get) => ({
  artboards: [],

  addArtboard: (artboard) => {
    const newArtboard: Artboard = { id: crypto.randomUUID(), ...artboard };
    set((s) => ({ artboards: [...s.artboards, newArtboard] }));
  },

  removeArtboard: (id) => {
    set((s) => ({ artboards: s.artboards.filter((a) => a.id !== id) }));
  },

  updateArtboard: (id, update) => {
    set((s) => ({
      artboards: s.artboards.map((a) => (a.id === id ? { ...a, ...update } : a)),
    }));
  },

  renameArtboard: (id, name) => {
    set((s) => ({
      artboards: s.artboards.map((a) => (a.id === id ? { ...a, name } : a)),
    }));
  },
});
