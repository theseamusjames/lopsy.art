import type { Layer } from '../../types';
import type { SliceCreator } from './types';
import { createImageData } from '../../engine/color-space';
import {
  cropToContentBounds,
  expandFromCrop,
  toSparsePixelData,
  fromSparsePixelData,
  sparseToImageData,
} from '../../engine/canvas-ops';
import { invalidateBitmapCache } from '../../engine/bitmap-cache';
import { readLayerAsImageData } from '../../engine-wasm/gpu-pixel-access';
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
  getOrCreateLayerPixelData: (layerId: string) => ImageData;
  updateLayerPixelData: (layerId: string, data: ImageData) => void;
  notifyRender: () => void;
  cropLayerToContent: (layerId: string) => void;
  expandLayerForEditing: (layerId: string) => ImageData;
  /** Read-only: returns ImageData from JS cache, sparse storage, or GPU
   *  readback (in that order). Returns at the layer's stored dimensions
   *  (not full canvas). */
  resolvePixelData: (layerId: string) => ImageData | undefined;
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

/** Union of canvas area and layer content area so that off-canvas content
 *  is preserved (non-destructive move). */
function unionBounds(
  docW: number, docH: number,
  cx: number, cy: number, cw: number, ch: number,
): { minX: number; minY: number; bufW: number; bufH: number } {
  const minX = Math.min(0, cx);
  const minY = Math.min(0, cy);
  const maxX = Math.max(docW, cx + cw);
  const maxY = Math.max(docH, cy + ch);
  return { minX, minY, bufW: maxX - minX, bufH: maxY - minY };
}

export const createPixelDataSlice: SliceCreator<PixelDataSlice> = (set, get) => ({
  dirtyLayerIds: new Set(),
  renderVersion: 0,

  getOrCreateLayerPixelData: (layerId: string) => {
    // Always returns a full-canvas-size ImageData, expanding cropped/sparse layers.
    // All callers are write operations (filters, paste, fill, etc.) that need
    // the full canvas area. Read-only code uses resolvePixelData().
    return get().expandLayerForEditing(layerId);
  },

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

  expandLayerForEditing: (layerId: string) => {
    const state = get();
    const layer = state.document.layers.find((l) => l.id === layerId);

    // Non-raster (text/shape/group/adjustment) — just return existing
    // dense data or an empty canvas-sized surface.
    if (!layer || layer.type !== 'raster') {
      const existing = pixelDataManager.get(layerId);
      if (existing) return existing;
      // Return a temporary empty buffer without persisting it.
      // The GPU is the source of truth for non-raster layers that have no
      // JS pixel data (e.g. a freshly duplicated text layer whose texture
      // was copied via duplicateLayerTexture). Storing empty data here
      // would cause syncLayers to overwrite the valid GPU texture.
      return createImageData(state.document.width, state.document.height);
    }

    const docW = state.document.width;
    const docH = state.document.height;

    // Sparse data first — expand into a dense ImageData sized to cover both
    // the canvas and the layer's content rect. layer.x/y is authoritative
    // (sparse offsets may be stale after an updateLayerPosition call).
    const sparseEntry = pixelDataManager.getSparse(layerId);
    if (sparseEntry) {
      const { minX, minY, bufW, bufH } = unionBounds(
        docW, docH,
        layer.x, layer.y,
        sparseEntry.sparse.width, sparseEntry.sparse.height,
      );
      const expanded = fromSparsePixelData(
        sparseEntry.sparse, bufW, bufH,
        layer.x - minX, layer.y - minY,
      );
      pixelDataManager.setDense(layerId, expanded);
      set({
        document: {
          ...state.document,
          layers: withLayerBounds(state.document.layers, layerId, {
            x: minX, y: minY, width: bufW, height: bufH,
          }),
        },
      });
      return expanded;
    }

    const existing = pixelDataManager.get(layerId);

    // Already covers the full canvas and all content is on-canvas.
    if (existing && layer.x === 0 && layer.y === 0 && existing.width >= docW && existing.height >= docH) {
      return existing;
    }

    // No JS data but GPU has data — read it back.
    if (!existing) {
      const gpuData = readLayerAsImageData(layerId);
      if (gpuData) {
        const { minX, minY, bufW, bufH } = unionBounds(docW, docH, layer.x, layer.y, gpuData.width, gpuData.height);
        const expanded = expandFromCrop(gpuData, layer.x - minX, layer.y - minY, bufW, bufH);
        pixelDataManager.setDense(layerId, expanded);
        set({
          document: {
            ...state.document,
            layers: withLayerBounds(state.document.layers, layerId, {
              x: minX, y: minY, width: bufW, height: bufH,
            }),
          },
        });
        return expanded;
      }
    }

    // Expand cropped data, preserving off-canvas content.
    if (existing) {
      const { minX, minY, bufW, bufH } = unionBounds(docW, docH, layer.x, layer.y, existing.width, existing.height);
      const expanded = expandFromCrop(existing, layer.x - minX, layer.y - minY, bufW, bufH);
      pixelDataManager.setDense(layerId, expanded);
      set({
        document: {
          ...state.document,
          layers: withLayerBounds(state.document.layers, layerId, {
            x: minX, y: minY, width: bufW, height: bufH,
          }),
        },
      });
      return expanded;
    }

    // Nothing anywhere — create an empty canvas-sized surface.
    const empty = createImageData(docW, docH);
    pixelDataManager.setDense(layerId, empty);
    set({
      document: {
        ...state.document,
        layers: withLayerBounds(state.document.layers, layerId, {
          x: 0, y: 0, width: docW, height: docH,
        }),
      },
    });
    return empty;
  },

  resolvePixelData: (layerId: string) => {
    const data = pixelDataManager.get(layerId);
    if (data) return data;
    const sparseEntry = pixelDataManager.getSparse(layerId);
    if (sparseEntry) return sparseToImageData(sparseEntry.sparse);
    const gpuData = readLayerAsImageData(layerId);
    if (gpuData) return gpuData;
    return undefined;
  },
});
