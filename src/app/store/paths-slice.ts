import type { PathAnchor } from '../../tools/path/path';
import type { StoredPath } from '../../types/paths';
import type { SliceCreator } from './types';

export interface PathsSlice {
  paths: StoredPath[];
  selectedPathId: string | null;
  addPath: (anchors: readonly PathAnchor[], closed: boolean) => void;
  removePath: (id: string) => void;
  selectPath: (id: string | null) => void;
  renamePath: (id: string, name: string) => void;
  updatePathAnchors: (id: string, anchors: readonly PathAnchor[], closed: boolean) => void;
}

let pathCounter = 0;

export const createPathsSlice: SliceCreator<PathsSlice> = (set, get) => ({
  paths: [],
  selectedPathId: null,

  addPath: (anchors, closed) => {
    pathCounter++;
    const newPath: StoredPath = {
      id: crypto.randomUUID(),
      name: `Path ${pathCounter}`,
      anchors: [...anchors],
      closed,
    };
    set({
      paths: [...get().paths, newPath],
      selectedPathId: newPath.id,
    });
  },

  removePath: (id) => {
    const state = get();
    set({
      paths: state.paths.filter((p) => p.id !== id),
      selectedPathId: state.selectedPathId === id ? null : state.selectedPathId,
    });
  },

  selectPath: (id) => {
    set({ selectedPathId: id });
  },

  renamePath: (id, name) => {
    set({
      paths: get().paths.map((p) => (p.id === id ? { ...p, name } : p)),
    });
  },

  updatePathAnchors: (id, anchors, closed) => {
    set({
      paths: get().paths.map((p) =>
        p.id === id ? { ...p, anchors: [...anchors], closed } : p,
      ),
    });
  },
});
