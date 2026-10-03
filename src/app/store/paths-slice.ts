import type { PathAnchor } from '../../tools/path/path';
import type { StoredPath } from '../../types/paths';
import type { SliceCreator } from './types';

export interface PathsSlice {
  paths: StoredPath[];
  selectedPathId: string | null;
  addPath: (anchors: readonly PathAnchor[], closed: boolean) => void;
  /** Records a "Delete Path" history entry unless `skipHistory` is set. */
  removePath: (id: string, skipHistory?: boolean) => void;
  selectPath: (id: string | null) => void;
  renamePath: (id: string, name: string) => void;
  updatePathAnchors: (id: string, anchors: readonly PathAnchor[], closed: boolean) => void;
}

const DEFAULT_PATH_NAME = /^Path (\d+)$/;

/**
 * The next default path name, numbered past every "Path N" in the current
 * document. Derived from the document rather than a session counter so a
 * reopened project or a new document never repeats a loaded name (#1086).
 */
export function nextPathName(paths: readonly Pick<StoredPath, 'name'>[]): string {
  let highest = 0;
  for (const path of paths) {
    const match = DEFAULT_PATH_NAME.exec(path.name);
    if (match) highest = Math.max(highest, Number(match[1]));
  }
  return `Path ${highest + 1}`;
}

export const createPathsSlice: SliceCreator<PathsSlice> = (set, get) => ({
  paths: [],
  selectedPathId: null,

  addPath: (anchors, closed) => {
    const newPath: StoredPath = {
      id: crypto.randomUUID(),
      name: nextPathName(get().paths),
      anchors: [...anchors],
      closed,
    };
    set({
      paths: [...get().paths, newPath],
      selectedPathId: newPath.id,
    });
  },

  removePath: (id, skipHistory = false) => {
    if (!get().paths.some((p) => p.id === id)) return;
    // Paths travel inside every history snapshot, so the entry must be pushed
    // before the removal for undo to bring the path back (#1179).
    if (!skipHistory) get().pushHistoryMetadata('Delete Path');
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
    const path = get().paths.find((p) => p.id === id);
    if (!path || path.name === name) return;
    get().pushHistoryMetadata('Rename Path');
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
