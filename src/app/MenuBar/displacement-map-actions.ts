import { useEditorStore } from '../editor-store';
import { clearJsPixelData } from '../store/clear-js-pixel-data';
import { getEngine } from '../../engine-wasm/engine-state';
import {
  filterDisplacementMap,
  saveFilterPreview,
  restoreFilterPreview,
  clearFilterPreview,
} from '../../engine-wasm/wasm-bridge';
import { readLayerCompressed, uploadCompressed } from '../../engine-wasm/gpu-pixel-access';
import { readLayerAsImageData } from '../../engine-wasm/gpu-pixel-access';
import { flushLayerSync } from '../../engine-wasm/engine-sync';
import { pixelDataManager } from '../../engine/pixel-data-manager';
import { fromSparsePixelData } from '../../engine/canvas-ops';

function getActiveLayerId(): string | null {
  return useEditorStore.getState().document.activeLayerId;
}

function getDisplacementPixels(sourceLayerId: string): { pixels: Uint8Array; width: number; height: number } | null {
  const imageData = readLayerAsImageData(sourceLayerId);
  if (imageData) {
    return { pixels: new Uint8Array(imageData.data.buffer), width: imageData.width, height: imageData.height };
  }

  const dense = pixelDataManager.get(sourceLayerId);
  if (dense) {
    return { pixels: new Uint8Array(dense.data.buffer), width: dense.width, height: dense.height };
  }

  const sparse = pixelDataManager.getSparse(sourceLayerId);
  if (sparse) {
    const doc = useEditorStore.getState().document;
    const layer = doc.layers.find((l) => l.id === sourceLayerId);
    if (!layer || layer.type === 'group') return null;
    const w = 'width' in layer && layer.width ? layer.width : doc.width;
    const h = 'height' in layer && layer.height ? layer.height : doc.height;
    const full = fromSparsePixelData(sparse.sparse, w, h, sparse.offsetX, sparse.offsetY);
    return { pixels: new Uint8Array(full.data.buffer), width: full.width, height: full.height };
  }

  return null;
}

export function beginDisplacementMapPreview(): void {
  const activeId = getActiveLayerId();
  if (!activeId) return;
  const engine = getEngine();
  if (!engine) return;
  const state = useEditorStore.getState();
  flushLayerSync(state);
  saveFilterPreview(engine, activeId);
}

export function previewDisplacementMap(
  sourceLayerId: string,
  scaleX: number,
  scaleY: number,
  edgeMode: number,
): void {
  const activeId = getActiveLayerId();
  if (!activeId) return;
  const engine = getEngine();
  if (!engine) return;

  flushLayerSync(useEditorStore.getState());

  const disp = getDisplacementPixels(sourceLayerId);
  if (!disp) return;

  restoreFilterPreview(engine);
  filterDisplacementMap(engine, activeId, disp.pixels, disp.width, disp.height, scaleX, scaleY, edgeMode);
  clearJsPixelData(activeId);
  useEditorStore.getState().notifyRender();
}

export function cancelDisplacementMapPreview(): void {
  const engine = getEngine();
  if (!engine) return;
  restoreFilterPreview(engine);
  clearFilterPreview(engine);
  const activeId = getActiveLayerId();
  if (activeId) {
    clearJsPixelData(activeId);
  }
  useEditorStore.getState().notifyRender();
}

export function applyDisplacementMap(
  sourceLayerId: string,
  scaleX: number,
  scaleY: number,
  edgeMode: number,
): void {
  const activeId = getActiveLayerId();
  if (!activeId) return;
  const engine = getEngine();
  if (!engine) return;

  const previewPixels = readLayerCompressed(activeId);

  restoreFilterPreview(engine);
  clearFilterPreview(engine);

  useEditorStore.getState().pushHistory('Displacement Map');

  if (previewPixels) {
    uploadCompressed(activeId, previewPixels);
  } else {
    flushLayerSync(useEditorStore.getState());

    const disp = getDisplacementPixels(sourceLayerId);
    if (!disp) return;

    filterDisplacementMap(engine, activeId, disp.pixels, disp.width, disp.height, scaleX, scaleY, edgeMode);
  }

  clearJsPixelData(activeId);
  useEditorStore.getState().notifyRender();
}

export function applyDisplacementMapDirect(
  sourceLayerId: string,
  scaleX: number,
  scaleY: number,
  edgeMode: number,
): void {
  const activeId = getActiveLayerId();
  if (!activeId) return;
  const engine = getEngine();
  if (!engine) return;

  flushLayerSync(useEditorStore.getState());

  const disp = getDisplacementPixels(sourceLayerId);
  if (!disp) return;

  useEditorStore.getState().pushHistory('Displacement Map');
  filterDisplacementMap(engine, activeId, disp.pixels, disp.width, disp.height, scaleX, scaleY, edgeMode);
  clearJsPixelData(activeId);
  useEditorStore.getState().notifyRender();
}
