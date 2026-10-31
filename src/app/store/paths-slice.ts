import type { PathAnchor } from '../../tools/path/path';
import type { StoredPath } from '../../types/paths';
import type { TextLayer } from '../../types';
import type { SliceCreator } from './types';
import { computeUnbindPathText } from './actions/unbind-path-text';
import { getEngine } from '../../engine-wasm/engine-state';
import { invalidatePathTextCache, rerenderCommittedTextLayer } from '../../engine-wasm/engine-sync';

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

export const createPathsSlice: SliceCreator<PathsSlice> = (set, get) => {
  /** Rasterize freshly unbound text at its anchor and store the texture's top-left. */
  const rerenderUnboundText = (layerIds: readonly string[]): void => {
    const engine = getEngine();
    if (!engine) return;
    for (const layerId of layerIds) {
      invalidatePathTextCache(layerId);
      const layer = get().document.layers.find((l): l is TextLayer => l.id === layerId && l.type === 'text');
      if (!layer) continue;
      const pos = rerenderCommittedTextLayer(engine, layer);
      if (pos) get().updateTextLayerProperties(layerId, { x: pos.x, y: pos.y });
    }
  };

  return {
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
      // Text bound to the path goes back to straight text at its pre-bind
      // anchor, as Path → None does. A dangling pathId would freeze the layer:
      // the path-text sync skips it for want of a path, and every other text
      // re-render skips it as path-bound (#1393).
      const unbound = computeUnbindPathText(state.document.layers, id);
      set({
        paths: state.paths.filter((p) => p.id !== id),
        selectedPathId: state.selectedPathId === id ? null : state.selectedPathId,
        ...(unbound && {
          document: { ...state.document, layers: unbound.layers },
          renderVersion: state.renderVersion + 1,
        }),
      });
      if (unbound) rerenderUnboundText(unbound.unboundIds);
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
  };
};
