import type { Layer } from '../../types';
import type { SliceCreator } from './types';
import {
  cropToContentBounds,
  toSparsePixelData,
} from '../../engine/canvas-ops';
import { invalidateBitmapCache } from '../../engine/bitmap-cache';
import { getEngine } from '../../engine-wasm/engine-state';
import { uploadLayerPixels } from '../../engine-wasm/wasm-bridge';
import { pixelDataManager } from '../../engine/pixel-data-manager';

/**
 * Pixel-data slice.
 *
 * The actual layer pixel maps live in {@link pixelDataManager} — not in
 * the store — so the "GPU is the source of truth" invariant from
 * CLAUDE.md is enforceable. What the store keeps is the *orchestration*:
 * `dirtyLayerIds` drives engine-sync re-uploads and `renderVersion`
 * drives re-renders.
 *
 * All the actions here are thin orchestrators that read/write the
 * manager, then emit state deltas for the store so subscribers
 * (LayerPanel, compositor, engine-sync) fire on the right beats.
 */
export interface PixelDataSlice {
  dirtyLayerIds: Set<string>;
  renderVersion: number;
  documentVersion: number;
  updateLayerPixelData: (layerId: string, data: ImageData) => void;
  notifyRender: () => void;
  cropLayerToContent: (layerId: string) => void;
}

/** Apply a new (x, y, width, height) to the given layer in document.layers. */
function withLayerBounds(
  layers: readonly Layer[],
  layerId: string,
  bounds: { x: number; y: number; width: number; height: number },
): Layer[] {
  return layers.map((l) =>
    l.id === layerId ? ({ ...l, ...bounds } as Layer) : l,
  );
}

export const createPixelDataSlice: SliceCreator<PixelDataSlice> = (set, get) => ({
  dirtyLayerIds: new Set(),
  renderVersion: 0,
  documentVersion: 0,

  updateLayerPixelData: (layerId: string, data: ImageData) => {
    pixelDataManager.setDense(layerId, data);
    invalidateBitmapCache(layerId);

    // Upload to GPU so the engine stays in sync.
    const engine = getEngine();
    if (engine) {
      const layer = get().document.layers.find((l) => l.id === layerId);
      const lx = layer?.x ?? 0;
      const ly = layer?.y ?? 0;
      const rawBytes = new Uint8Array(data.data.buffer, data.data.byteOffset, data.data.byteLength);
      uploadLayerPixels(engine, layerId, rawBytes, data.width, data.height, lx, ly);
    }

    set((state) => ({
      dirtyLayerIds: new Set(state.dirtyLayerIds).add(layerId),
      renderVersion: state.renderVersion + 1,
    }));

    // Auto-crop/sparsify after every write to keep memory tight.
    get().cropLayerToContent(layerId);
  },

  notifyRender: () => {
    set((state) => ({ renderVersion: state.renderVersion + 1 }));
  },

  cropLayerToContent: (layerId: string) => {
    const data = pixelDataManager.get(layerId);
    if (!data) return;

    const state = get();
    const layer = state.document.layers.find((l) => l.id === layerId);
    if (!layer || layer.type !== 'raster') return;

    const crop = cropToContentBounds(data);
    if (!crop) {
      // Fully empty — remove pixel data entirely.
      invalidateBitmapCache(layerId);
      pixelDataManager.remove(layerId);
      set({
        document: {
          ...state.document,
          layers: withLayerBounds(state.document.layers, layerId, {
            x: 0, y: 0,
            width: state.document.width, height: state.document.height,
          }),
        },
        renderVersion: state.renderVersion + 1,
      });
      return;
    }

    // Try to sparsify the cropped data.
    const sparse = toSparsePixelData(crop.data);
    if (sparse) {
      invalidateBitmapCache(layerId);
      pixelDataManager.setSparse(layerId, {
        offsetX: layer.x + crop.x,
        offsetY: layer.y + crop.y,
        sparse,
      });
      set({
        document: {
          ...state.document,
          layers: withLayerBounds(state.document.layers, layerId, {
            x: layer.x + crop.x, y: layer.y + crop.y,
            width: crop.data.width, height: crop.data.height,
          }),
        },
        dirtyLayerIds: new Set(state.dirtyLayerIds).add(layerId),
        renderVersion: state.renderVersion + 1,
      });
      return;
    }

    // Dense content — keep as cropped ImageData.
    if (crop.x === 0 && crop.y === 0 && crop.data.width === data.width && crop.data.height === data.height) return;

    pixelDataManager.setDense(layerId, crop.data);
    set({
      document: {
        ...state.document,
        layers: withLayerBounds(state.document.layers, layerId, {
          x: layer.x + crop.x, y: layer.y + crop.y,
          width: crop.data.width, height: crop.data.height,
        }),
      },
      dirtyLayerIds: new Set(state.dirtyLayerIds).add(layerId),
      renderVersion: state.renderVersion + 1,
    });
  },
});
